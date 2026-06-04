"""
tmap.py
TMAP Pedestrian Routes API 프록시 — 프론트엔드에서 직접 TMAP을 호출하는 대신
FastAPI 서버를 통해 호출하도록 프록시.
API 키는 서버 환경변수에서 주입.
"""

import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["TMAP"])

_TMAP_KEY  = os.getenv("TMAP_APP_KEY", "")
_TMAP_BASE = "https://apis.openapi.sk.com/tmap"


@router.post("/pedestrian")
async def pedestrian_route(request: Request):
    """TMAP 도보 경로 탐색 프록시 (출발지 → 도착지)"""
    body = await request.json()
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{_TMAP_BASE}/routes/pedestrian",
            params={"version": "1", "format": "json"},
            json=body,
            headers={
                "appKey": _TMAP_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
    return JSONResponse(content=res.json(), status_code=res.status_code)
