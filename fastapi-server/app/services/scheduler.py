"""
services/scheduler.py

FastAPI lifespan에 붙는 백그라운드 폴링 스케줄러.

폴링 주기:
  - 재난문자·사고통제·인구·교통: 5분

서울시 citydata API 한 번 호출에 위 데이터가 모두 포함되므로
5분마다 전 지역을 순회함.

seoul_api.py 연동 후 변경 사항:
  - httpx 직접 호출 제거 → SeoulApiClient.fetch_citydata() 사용
  - raw dict 파싱 제거 → CityData dataclass 그대로 사용
  - _extract_list / _extract_first 헬퍼 제거 (seoul_api.py가 담당)
  - event_detector에 넘기는 데이터도 dataclass 필드에서 추출
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from datetime import datetime

from app.services.cache import CacheStrategy, cache as default_cache
from app.services.event_detector import EventDetector
from app.services.seoul_api import SeoulApiClient, CityData
from app.services.ttl_tracker import TtlTracker

logger = logging.getLogger(__name__)

# 서울시 실시간 도시데이터 핫스팟 (전체 122곳 중 대표 목록)
HOTSPOT_AREAS: list[str] = [
    # 관광특구 (7개)
    "강남 MICE 관광특구", "동대문 관광특구", "명동 관광특구",
    "이태원 관광특구", "잠실 관광특구", "종로·청계 관광특구",
    "홍대 관광특구",
    # 고궁·문화유산 (5개)
    "경복궁", "광화문·덕수궁", "보신각",
    "서울 암사동 유적", "창덕궁·종묘",
    # 발달상권
    "북촌한옥마을", "인사동", "익선동",
    # 공원·한강
    "서울숲공원", "여의도한강공원", "뚝섬한강공원",
    "반포한강공원", "망원한강공원", "난지한강공원",
    "국립중앙박물관·용산가족공원", "서울대공원",
    # 기존 3개 제거하고 매뉴얼 있는 장소로 교체
    "남산공원", "DDP(동대문디자인플라자)", "강남역",
]

_INTERVAL_CITYDATA = 300    # 5분
_TTL_POPULATION    = 300    # 5분
_TTL_TRAFFIC       = 300    # 5분
_CONCURRENCY       = 10     # 동시 API 호출 상한 (rate limit 방어)
_MAX_BACKOFF       = 1800   # 연속 실패 시 최대 대기 30분


class Scheduler:
    """
    FastAPI lifespan과 연동하는 백그라운드 폴러.

    사용법 (main.py):
        @asynccontextmanager
        async def lifespan(app):
            await scheduler.start()
            yield
            await scheduler.stop()
    """

    def __init__(
        self,
        cache: CacheStrategy | None = None,
        detector: EventDetector | None = None,
        api_client: SeoulApiClient | None = None,
    ) -> None:
        self._cache      = cache or default_cache
        self._detector   = detector or EventDetector()
        self._api        = api_client or SeoulApiClient()
        self._ttl_tracker = TtlTracker(api_client=self._api)
        self._tasks: list[asyncio.Task] = []
        self._sem        = asyncio.Semaphore(_CONCURRENCY)
        self._count_lock = asyncio.Lock()
        self._api_call_count    = 0

    # ── lifespan 훅 ──────────────────────────────

    async def start(self) -> None:
        if hasattr(self._cache, "start"):
            await self._cache.start()

        # 서버 재시작 직후 중복 알림 방지 — 최근 24시간 event_id 복원
        self._detector.load_seen_ids()

        self._tasks = [
            asyncio.create_task(
                self._loop(self._poll_all_areas, _INTERVAL_CITYDATA),
                name="scheduler-citydata",
            ),
            asyncio.create_task(
                self._ttl_tracker.run(),
                name="scheduler-ttl",
            ),
        ]
        logger.info("[Scheduler] 시작 — 재난·인구·교통 5분 주기 | TTL 추적 활성화")

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

        if hasattr(self._cache, "stop"):
            await self._cache.stop()

        logger.info(f"[Scheduler] 종료 — 총 API 호출: {self._api_call_count}회")

    # ── 폴링 루프 ────────────────────────────────

    async def _loop(self, fn, interval_s: int) -> None:
        """
        즉시 1회 실행 후 interval_s마다 반복.
        연속 실패 시 exponential backoff 적용 (최대 30분).
        성공하면 fail_count 초기화 → 정상 주기로 복귀.
        """
        fail_count = 0
        while True:
            try:
                await fn()
                fail_count = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                fail_count += 1
                logger.error(f"[Scheduler] 폴링 오류 ({fail_count}회 연속): {exc}")

            wait = min(interval_s * (2 ** min(fail_count, 6)), _MAX_BACKOFF)
            if fail_count > 0:
                logger.warning(f"[Scheduler] {wait}초 후 재시도 (연속 실패 {fail_count}회)")
            await asyncio.sleep(wait)

    async def _poll_all_areas(self) -> None:
        """전체 핫스팟을 Semaphore로 동시성 제한하며 폴링"""
        results = await asyncio.gather(
            *[self._poll_area(area) for area in HOTSPOT_AREAS],
            return_exceptions=True,
        )
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            logger.warning(f"[Scheduler] 이번 폴링 오류 {len(errors)}건")

    async def _poll_area(self, area_nm: str) -> None:
        """
        단일 장소 폴링.
        SeoulApiClient가 HTTP 호출 + 파싱을 담당하고
        Scheduler는 결과(CityData)를 캐시/감지기에 라우팅만 함.
        """
        async with self._sem:
            citydata: CityData | None = await self._api.fetch_citydata(area_nm)

            if citydata is None:
                return

            async with self._count_lock:
                self._api_call_count += 1

            await self._handle_citydata(citydata)

    # ── 데이터 라우팅 ─────────────────────────────

    async def _handle_citydata(self, data: CityData) -> None:
        """
        파싱된 CityData를 분야별로 라우팅.
        raw dict 파싱은 seoul_api.py가 이미 완료한 상태.
        """
        await asyncio.gather(
            self._route_disaster(data),
            self._route_accident(data),
            self._route_population(data),
            self._route_traffic(data),
        )

    async def _route_disaster(self, data: CityData) -> None:
        """재난문자 → event_detector로 전달 (dict 변환해서)"""
        if not data.disasters:
            return
        # event_detector는 dict 리스트를 기대하므로 dataclass → dict 변환
        raw_items = [dataclasses.asdict(d) for d in data.disasters]
        await self._detector.process_disaster(raw_items)

    async def _route_accident(self, data: CityData) -> None:
        """사고통제 → event_detector로 전달"""
        if not data.accidents:
            return
        raw_items = [dataclasses.asdict(a) for a in data.accidents]
        await self._detector.process_accident(raw_items)

    async def _route_population(self, data: CityData) -> None:
        """인구 혼잡도 → 캐시 저장"""
        if not data.population:
            return
        await self._cache.set(
            f"population:{data.area_nm}",
            dataclasses.asdict(data.population),
            ttl=_TTL_POPULATION,
        )

    async def _route_traffic(self, data: CityData) -> None:
        """교통 정보 → 캐시 저장"""
        if not data.traffic:
            return
        await self._cache.set(
            f"traffic:{data.area_nm}",
            [dataclasses.asdict(t) for t in data.traffic],
            ttl=_TTL_TRAFFIC,
        )

    # ── 공개 속성 ─────────────────────────────────

    def register_disaster_ttl(
        self,
        db_id: int,
        dst_msg: str,
        area_nm: str,
        received_at: datetime,
    ) -> None:
        """신규 재난을 TTL 추적기에 등록."""
        self._ttl_tracker.register(db_id, dst_msg, area_nm, received_at)

    @property
    def detector(self) -> EventDetector:
        return self._detector

    @property
    def api_call_count(self) -> int:
        return self._api_call_count

    @property
    def ttl_active_count(self) -> int:
        return self._ttl_tracker.active_count


# 싱글턴 — main.py에서 import해서 lifespan에 연결
scheduler = Scheduler()