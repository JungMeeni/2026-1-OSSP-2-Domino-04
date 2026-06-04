"""
tripadvisor.py
TripAdvisor Content API 프록시.

[구조]
  프론트 → /api/tripadvisor/... → FastAPI(이 파일) → TripAdvisor Content API v1

[알려진 이슈 — 403 "explicit deny"]
  TripAdvisor 백엔드가 AWS API Gateway + WAF로 구성되어 있으며,
  서버·클라우드 IP(Docker, EC2, GCP 등)에서 오는 요청을 명시적으로 차단한다.
  API 키가 유효해도 키 길이가 32자로 정상 로딩되어도 403이 반환된다.
  에러 본문: {"Message": "User is not authorized to access this resource with an explicit deny"}

  현재 상태: 이 프록시를 통한 호출은 항상 403으로 실패하며, 평점이 표시되지 않는다.

[해결 방향]
  Option A) 주거용 프록시(residential proxy) 경유
            httpx.AsyncClient(proxies={"https://": "http://PROXY_HOST:PORT"})
            → 클라우드 IP 우회 가능, 단 프록시 서비스 비용 발생

  Option B) 프론트엔드에서 브라우저 직접 호출로 전환
            브라우저 IP는 차단되지 않음. VITE_TRIPADVISOR_API_KEY 이미 .env에 있음.
            Usekakaonearby.ts의 taUrl() 을 TripAdvisor 직접 URL로 교체하면 됨.
            단, API 키가 번들에 노출되는 트레이드오프 있음.

  Option C) TripAdvisor 대신 Google Places API로 교체
            서버-서버 호출 정상 동작, 평점·리뷰 수 동일하게 제공.
            GOOGLE_PLACES_API_KEY를 .env에 추가하고 엔드포인트만 교체.

[기타 이슈 메모]
  - os.getenv()를 모듈-레벨 상수로 읽으면 load_dotenv() 이전에 실행될 수 있어
    빈 문자열이 캡처된다. API 키는 요청마다 os.getenv()로 늦게 읽도록 되어 있음.
  - Referer/Origin 헤더를 임의의 도메인으로 설정하면 추가 403 원인이 될 수 있어 제거함.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["TripAdvisor"])

_TA_BASE = "https://api.content.tripadvisor.com/api/v1"


def _build_headers() -> dict:
    key = os.getenv("TRIPADVISOR_API_KEY", "")
    return {
        "accept":                "application/json",
        "X-TripAdvisor-API-Key": key,
    }


def _graceful_error(status: int, endpoint: str, body: str) -> Optional[JSONResponse]:
    """401/403/429를 서버에서 흡수하고 프론트에는 빈 결과(200)를 반환한다.
    실제 원인은 FastAPI 로그에서 확인할 것."""
    if status not in (401, 403, 429):
        return None
    key_len = len(os.getenv("TRIPADVISOR_API_KEY", ""))
    logger.warning(
        "TripAdvisor %s → %d  (key_len=%d)  %.300s",
        endpoint, status, key_len, body,
    )
    return JSONResponse(content={"data": []}, status_code=200)


@router.get("/location/search")
async def location_search(request: Request):
    key = os.getenv("TRIPADVISOR_API_KEY", "")
    params = dict(request.query_params)
    params.pop("key", None)
    params["key"] = key

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"{_TA_BASE}/location/search",
                params=params,
                headers=_build_headers(),
            )
    except Exception as e:
        logger.warning("TripAdvisor /location/search 네트워크 오류: %s", e)
        return JSONResponse(content={"data": []}, status_code=200)

    fallback = _graceful_error(res.status_code, "/location/search", res.text)
    if fallback:
        return fallback
    return JSONResponse(content=res.json(), status_code=res.status_code)


@router.get("/location/{location_id}/details")
async def location_details(location_id: str, request: Request):
    key = os.getenv("TRIPADVISOR_API_KEY", "")
    params = dict(request.query_params)
    params.pop("key", None)
    params["key"] = key

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"{_TA_BASE}/location/{location_id}/details",
                params=params,
                headers=_build_headers(),
            )
    except Exception as e:
        logger.warning("TripAdvisor /location/%s/details 네트워크 오류: %s", location_id, e)
        return JSONResponse(content={}, status_code=200)

    if res.status_code in (401, 403, 429):
        key_len = len(key)
        logger.warning(
            "TripAdvisor /location/%s/details → %d  (key_len=%d)  %.300s",
            location_id, res.status_code, key_len, res.text,
        )
        return JSONResponse(content={}, status_code=200)
    return JSONResponse(content=res.json(), status_code=res.status_code)
