"""
kakao.py
Kakao Directions API 프록시 — 프론트엔드에서 직접 Kakao를 호출하는 대신
FastAPI 서버를 통해 호출하도록 프록시.
API 키는 서버 환경변수에서 주입.
"""

import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Kakao"])

_KAKAO_KEY           = os.getenv("KAKAO_REST_API_KEY", "")
_KAKAO_DIRECTIONS_URL = os.getenv(
    "KAKAO_DIRECTIONS_URL",
    "https://apis-navi.kakaomobility.com/v1/directions",
)


@router.get("/directions")
async def proxy_directions(request: Request):
    """Kakao Mobility Directions API 프록시 (경로 탐색)"""
    params = dict(request.query_params)
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            _KAKAO_DIRECTIONS_URL,
            params=params,
            headers={"Authorization": f"KakaoAK {_KAKAO_KEY}"},
        )
    return JSONResponse(content=res.json(), status_code=res.status_code)
