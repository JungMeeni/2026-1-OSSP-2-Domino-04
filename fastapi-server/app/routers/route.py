import math
import json
import os
from typing import Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db

router = APIRouter(tags=["Route"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EARTH_RADIUS_M = 6_371_000
VERTEX_SAMPLE_STEP = 3

_WEIGHTS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "category_weights.json")
_DEFAULT_WEIGHTS: Dict[str, float] = {
    "명소": 1.4, "식당": 1.4, "문화": 1.3, "공원": 1.2, "카페": 1.1, "갤러리": 1.1, "거리": 1.0,
}
_LEARNING_RATE = 0.05

_ML_SERVER_URL = os.getenv("ML_SERVER_URL", "http://ml-server:8001")


# ---------------------------------------------------------------------------
# Weight persistence
# ---------------------------------------------------------------------------

def _load_weights() -> Dict[str, float]:
    try:
        if os.path.exists(_WEIGHTS_FILE):
            with open(_WEIGHTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {k: float(data.get(k, v)) for k, v in _DEFAULT_WEIGHTS.items()}
    except Exception:
        pass
    return _DEFAULT_WEIGHTS.copy()


def _save_weights(weights: Dict[str, float]) -> None:
    os.makedirs(os.path.dirname(_WEIGHTS_FILE), exist_ok=True)
    with open(_WEIGHTS_FILE, "w", encoding="utf-8") as f:
        json.dump(weights, f, ensure_ascii=False, indent=2)


def _update_weights(weights: Dict[str, float], selected_categories: List[str]) -> Dict[str, float]:
    selected = set(selected_categories)
    new_weights: Dict[str, float] = {}
    for cat, w in weights.items():
        if cat in selected:
            new_weights[cat] = w * (1.0 + _LEARNING_RATE)
        else:
            new_weights[cat] = w * (1.0 - _LEARNING_RATE * 0.3)

    base_sum = sum(_DEFAULT_WEIGHTS.values())
    cur_sum = sum(new_weights.values())
    ratio = base_sum / cur_sum if cur_sum > 0 else 1.0
    return {cat: round(v * ratio, 4) for cat, v in new_weights.items()}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _load_active_disasters(db: Session) -> list:
    rows = db.execute(
        text("""
            SELECT
                ST_X(coordinates) AS lat,
                ST_Y(coordinates) AS lng,
                radius_m,
                weight_penalty
            FROM DisasterAlerts
            WHERE expires_at > NOW()
        """)
    ).fetchall()
    return [
        {
            "lat": float(row.lat),
            "lng": float(row.lng),
            "radius_m": int(row.radius_m),
            "weight_penalty": int(row.weight_penalty),
        }
        for row in rows
    ]


def _check_vertex_against_disasters(v_lat: float, v_lng: float, disasters: list) -> list:
    hits = []
    for d in disasters:
        dist = _haversine_distance(v_lat, v_lng, d["lat"], d["lng"])
        if dist < (d["radius_m"] + 50):
            hits.append(d)
    return hits


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RouteCalculateRequest(BaseModel):
    routeData: dict


class FeedbackRequest(BaseModel):
    selected_categories: List[str]
    route_type: str = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/weights")
def get_weights():
    """현재 카테고리 추천 가중치 반환"""
    return _load_weights()


@router.post("/feedback")
def update_weights_from_feedback(request: FeedbackRequest):
    """사용자가 선택한 경로의 카테고리 기반으로 가중치 업데이트."""
    weights = _load_weights()
    updated = _update_weights(weights, request.selected_categories)
    _save_weights(updated)
    return {"updated_weights": updated}


@router.post("/calculate")
def calculate_route(
    request: RouteCalculateRequest,
    db: Session = Depends(get_db),
):
    """카카오 Directions API 응답을 받아 활성 재난 구역과 겹치는 구간을 계산."""
    try:
        disasters = _load_active_disasters(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB query failed: {str(e)}")

    if not disasters:
        return {
            "is_safe": True,
            "total_penalty": 0,
            "affected_sections": [],
            "disaster_warnings": [],
        }

    routes = request.routeData.get("routes", [])
    if not routes:
        raise HTTPException(status_code=400, detail="routeData contains no routes")

    total_penalty = 0
    affected_sections: list = []
    disaster_warnings: list = []

    sections = routes[0].get("sections", [])
    for section_idx, section in enumerate(sections):
        section_max_penalty = 0

        for road_idx, road in enumerate(section.get("roads", [])):
            vertexes = road.get("vertexes", [])
            i = 0
            vertex_num = 0
            while i + 1 < len(vertexes):
                if vertex_num % VERTEX_SAMPLE_STEP == 0:
                    v_lng = vertexes[i]
                    v_lat = vertexes[i + 1]
                    hits = _check_vertex_against_disasters(v_lat, v_lng, disasters)
                    for hit in hits:
                        penalty = hit["weight_penalty"]
                        section_max_penalty = max(section_max_penalty, penalty)
                        disaster_warnings.append({
                            "section": section_idx,
                            "road": road_idx,
                            "penalty": penalty,
                            "disaster_center": {"lat": hit["lat"], "lng": hit["lng"]},
                        })
                i += 2
                vertex_num += 1

        if section_max_penalty > 0:
            affected_sections.append(section_idx)
            total_penalty += section_max_penalty

    return {
        "is_safe": len(affected_sections) == 0,
        "total_penalty": total_penalty,
        "affected_sections": affected_sections,
        "disaster_warnings": disaster_warnings,
    }


# ---------------------------------------------------------------------------
# ML 서버 프록시 — routemodel은 ml-server 컨테이너에서 실행
# ---------------------------------------------------------------------------

@router.post("/recommend")
async def proxy_recommend(request: Request):
    """ML 서버로 경로 추천 요청을 프록시 (MLP 채점 + Held-Karp+2-opt)"""
    body = await request.json()
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(f"{_ML_SERVER_URL}/recommend", json=body)
    return JSONResponse(content=res.json(), status_code=res.status_code)


@router.post("/recommend/feedback")
async def proxy_feedback(request: Request):
    """ML 서버로 피드백 전달 (온라인 학습 — BCE + Adam)"""
    body = await request.json()
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(f"{_ML_SERVER_URL}/recommend/feedback", json=body)
    return JSONResponse(content=res.json(), status_code=res.status_code)
