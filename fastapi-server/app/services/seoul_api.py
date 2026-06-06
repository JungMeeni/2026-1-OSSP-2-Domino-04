"""
services/seoul_api.py

서울시 실시간 도시데이터 API 호출 + 파싱 클라이언트.
실제 API 응답 구조 기반으로 작성 (경복궁 응답 확인 완료).

실제 확인된 응답 구조:
    {
        "CITYDATA": {
            "LIVE_PPLTN_STTS": [ { ...25개 필드... } ],
            "LIVE_DST_MESSAGE": [ { ...5개 필드... } ],
            "ACDNT_CNTRL_STTS": [ { ...9개 필드... } ],
            "ROAD_TRAFFIC_STTS": [ { ...17개 필드... } ],
            ...
        }
    }

사용 예시:
    client = SeoulApiClient()
    result = await client.fetch_citydata("경복궁")
    print(result.population.congestion_level)   # "약간 붐빔"
    print(result.population.forecast[0])        # 1시간 후 예측
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

SEOUL_API_KEY = os.getenv("SEOUL_API_KEY", "")
_BASE_URL = "http://openapi.seoul.go.kr:8088/{key}/json/citydata/1/1/{area}"


# ──────────────────────────────────────────────
# 파싱된 데이터 구조 (dataclass)
# ──────────────────────────────────────────────

@dataclass
class PopulationForecast:
    """FCST_PPLTN 한 항목 — 미래 시점별 혼잡도 예측"""
    time: str               # "2026-05-24 15:00"
    congestion_level: str   # "붐빔" / "약간 붐빔" / "보통" / "여유"
    ppltn_min: int          # 예측 최소 인구
    ppltn_max: int          # 예측 최대 인구


@dataclass
class PopulationData:
    """
    LIVE_PPLTN_STTS 파싱 결과.
    경로 위험 판단 + 앱 알림에 필요한 필드만 추출.
    """
    area_nm: str                            # 장소명
    area_cd: str                            # 장소 코드 (POI008 등)
    congestion_level: str                   # 현재 혼잡도: 여유/보통/약간 붐빔/붐빔
    congestion_msg: str                     # 혼잡도 상세 메시지
    ppltn_min: int                          # 현재 최소 인구
    ppltn_max: int                          # 현재 최대 인구
    non_resnt_rate: float                   # 외지인 비율 (관광객 밀집 판단용)
    ppltn_time: str                         # 데이터 기준 시각
    forecast: list[PopulationForecast]      # 향후 12시간 예측


@dataclass
class DisasterMessage:
    """LIVE_DST_MESSAGE 파싱 결과"""
    area_nm: str
    dst_se_nm: str      # 재난 유형명
    dst_msg: str        # 재난문자 내용
    rcptn_rgn_nm: str   # 수신 지역명
    crt_dt: str         # 생성 일시


@dataclass
class AccidentInfo:
    """ACDNT_CNTRL_STTS 파싱 결과"""
    area_nm: str
    acdnt_type: str         # 사고 유형
    acdnt_dtl_type: str     # 세부 유형
    acdnt_occr_dt: str      # 발생 일시
    exp_clr_dt: str         # 해제 예정 일시


@dataclass
class TrafficInfo:
    """ROAD_TRAFFIC_STTS 파싱 결과 (경로 우회 판단용)"""
    area_nm: str
    road_traffic_idx: str   # 도로 소통 지수: 원활/서행/지체/정체
    avg_speed: float        # 평균 속도 (km/h)


@dataclass
class CityData:
    """
    fetch_citydata() 반환 타입.
    한 장소의 모든 분야 데이터를 담는 컨테이너.
    None이면 해당 분야 데이터가 응답에 없는 것.
    """
    area_nm: str
    population: PopulationData | None = None
    disasters: list[DisasterMessage] = field(default_factory=list)
    accidents: list[AccidentInfo] = field(default_factory=list)
    traffic: list[TrafficInfo] = field(default_factory=list)


# ──────────────────────────────────────────────
# 파싱 함수
# ──────────────────────────────────────────────

def _parse_population(items: list[dict]) -> PopulationData | None:
    """LIVE_PPLTN_STTS 리스트에서 첫 번째 항목을 파싱"""
    if not items:
        return None
    d = items[0]

    # 향후 혼잡도 예측 파싱
    forecast = [
        PopulationForecast(
            time=f.get("FCST_TIME", ""),
            congestion_level=f.get("FCST_CONGEST_LVL", ""),
            ppltn_min=int(f.get("FCST_PPLTN_MIN", 0)),
            ppltn_max=int(f.get("FCST_PPLTN_MAX", 0)),
        )
        for f in d.get("FCST_PPLTN", [])
    ]

    return PopulationData(
        area_nm=d.get("AREA_NM", ""),
        area_cd=d.get("AREA_CD", ""),
        congestion_level=d.get("AREA_CONGEST_LVL", ""),
        congestion_msg=d.get("AREA_CONGEST_MSG", ""),
        ppltn_min=int(d.get("AREA_PPLTN_MIN", 0)),
        ppltn_max=int(d.get("AREA_PPLTN_MAX", 0)),
        non_resnt_rate=float(d.get("NON_RESNT_PPLTN_RATE", 0)),
        ppltn_time=d.get("PPLTN_TIME", ""),
        forecast=forecast,
    )


def _parse_disasters(items: list[dict]) -> list[DisasterMessage]:
    """LIVE_DST_MESSAGE 리스트 파싱. 내용 없는 항목 제외."""
    return [
        DisasterMessage(
            area_nm=d.get("AREA_NM", ""),
            dst_se_nm=d.get("DST_SE_NM", ""),
            dst_msg=d.get("DST_MSG", ""),
            rcptn_rgn_nm=d.get("RCPTN_RGN_NM", ""),
            crt_dt=d.get("CRT_DT", ""),
        )
        for d in items
        if d.get("DST_MSG")  # 빈 항목 제외
    ]


def _parse_accidents(items: list[dict]) -> list[AccidentInfo]:
    """ACDNT_CNTRL_STTS 리스트 파싱"""
    return [
        AccidentInfo(
            area_nm=d.get("AREA_NM", ""),
            acdnt_type=d.get("ACDNT_TYPE", ""),
            acdnt_dtl_type=d.get("ACDNT_DTL_TYPE", ""),
            acdnt_occr_dt=d.get("ACDNT_OCCR_DT", ""),
            exp_clr_dt=d.get("EXP_CLR_DT", ""),
        )
        for d in items
        if d.get("ACDNT_TYPE")
    ]


def _parse_traffic(data: dict | list) -> list[TrafficInfo]:
    """
    ROAD_TRAFFIC_STTS는 두 가지 구조로 올 수 있음:
      - dict: {"AVG_ROAD_DATA": {...}, "ROAD_TRAFFIC_STTS": [...]}
      - list: 이미 리스트인 경우 (혹시 모를 fallback)
    """
    # dict면 AVG_ROAD_DATA에서 전체 평균 정보 추출
    if isinstance(data, dict):
        avg = data.get("AVG_ROAD_DATA", {})
        return [
            TrafficInfo(
                area_nm="",
                road_traffic_idx=avg.get("ROAD_TRAFFIC_IDX", ""),
                avg_speed=float(avg.get("ROAD_TRAFFIC_SPD", 0) or 0),
            )
        ] if avg else []

    # list면 기존 방식
    if isinstance(data, list):
        return [
            TrafficInfo(
                area_nm=d.get("AREA_NM", "") if isinstance(d, dict) else "",
                road_traffic_idx=d.get("IDX", "") if isinstance(d, dict) else "",
                avg_speed=float(d.get("SPD", 0) or 0) if isinstance(d, dict) else 0,
            )
            for d in data
        ]

    return []

# ──────────────────────────────────────────────
# API 클라이언트
# ──────────────────────────────────────────────

class SeoulApiClient:
    """
    서울시 citydata API 비동기 클라이언트.

    사용 예시:
        client = SeoulApiClient()
        data = await client.fetch_citydata("경복궁")

        # 혼잡도
        print(data.population.congestion_level)

        # 향후 예측 (가장 가까운 1시간 후)
        print(data.population.forecast[0].congestion_level)

        # 재난문자
        for d in data.disasters:
            print(d.dst_msg)
    """

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or SEOUL_API_KEY
        if not self._api_key:
            logger.warning("[SeoulApiClient] SEOUL_API_KEY가 설정되지 않았습니다.")

    async def fetch_citydata(self, area_nm: str) -> CityData | None:
        """
        단일 장소의 citydata 전체를 가져와서 파싱 후 반환.

        Args:
            area_nm: 핫스팟 장소명 (예: "경복궁", "홍대 관광특구")

        Returns:
            CityData 객체. API 오류 시 None.
        """
        url = _BASE_URL.format(key=self._api_key, area=area_nm)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
        except httpx.TimeoutException:
            logger.warning(f"[SeoulApiClient] {area_nm} 요청 타임아웃")
            return None
        except httpx.HTTPStatusError as e:
            logger.warning(f"[SeoulApiClient] {area_nm} HTTP 오류: {e.response.status_code}")
            return None
        except Exception as e:
            logger.warning(f"[SeoulApiClient] {area_nm} 요청 실패: {e}")
            return None

        body = resp.json()

        # 실제 확인된 응답 구조: 최상위가 바로 "CITYDATA"
        citydata = body.get("CITYDATA")
        if not citydata:
            logger.debug(f"[SeoulApiClient] {area_nm} CITYDATA 없음")
            return None

        return CityData(
            area_nm=area_nm,
            population=_parse_population(
                citydata.get("LIVE_PPLTN_STTS", [])
            ),
            disasters=_parse_disasters(
                citydata.get("LIVE_DST_MESSAGE", [])
            ),
            accidents=_parse_accidents(
                citydata.get("ACDNT_CNTRL_STTS", [])
            ),
            traffic=_parse_traffic(
                citydata.get("ROAD_TRAFFIC_STTS") or []
            ),
        )

    async def fetch_multiple(self, area_names: list[str]) -> dict[str, CityData]:
        """
        여러 장소를 순차적으로 가져옴.
        (동시 호출은 scheduler.py의 Semaphore가 담당)

        Returns:
            { "경복궁": CityData, "홍대 관광특구": CityData, ... }
        """
        results = {}
        for area in area_names:
            data = await self.fetch_citydata(area)
            if data:
                results[area] = data
        return results


# 싱글턴
seoul_api = SeoulApiClient()