"""
routemodel.py — 관광지 추천 경로 생성 AI 모델

[데이터 흐름]
  POST /route/recommend
    → 블랙리스트 필터링
    → 코스별 독립 MLP로 장소 점수 계산
        A코스: PlaceScoringNetA  (weights_A.pt)
        B코스: PlaceScoringNetB  (weights_B.pt) — 거리 특성 포함
        C코스: PlaceScoringNetC  (weights_C.pt)
    → 코스별 장소 선정 → Dijkstra+Held-Karp+2-opt 경로 최적화
    → 3개 코스 반환

  POST /route/recommend/feedback
    → 선택 코스(positive) / 나머지(negative) BCE 손실
    → Adam 온라인 학습 (3개 모델 동시 갱신)
    → weights_A/B/C.pt 저장 → 다음 요청부터 반영
"""

from __future__ import annotations

import math
import os
import threading
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

import torch
import torch.nn as nn
import torch.nn.functional as F

import networkx as nx
import geopandas as gpd
from shapely.geometry import Point

try:
    from zoneinfo import ZoneInfo
    def _now_seoul() -> datetime:
        return datetime.now(ZoneInfo("Asia/Seoul"))
except ImportError:
    import pytz
    def _now_seoul() -> datetime:
        return datetime.now(pytz.timezone("Asia/Seoul"))

from fastapi import APIRouter
from pydantic import BaseModel
from app.routers.route import load_category_weights

import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# fastapi-server/app/routers/ 기준으로 두 단계 위(fastapi-server/)의 weights/ 디렉터리
_WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "weights")
_WEIGHTS_A   = os.path.join(_WEIGHTS_DIR, "weights_A.pt")
_WEIGHTS_B   = os.path.join(_WEIGHTS_DIR, "weights_B.pt")
_WEIGHTS_C   = os.path.join(_WEIGHTS_DIR, "weights_C.pt")
_MODEL_LOCK = threading.Lock()   # 동시 피드백 요청 직렬화


# ══════════════════════════════════════════════════════════
# 1. Pydantic 스키마
# ══════════════════════════════════════════════════════════

class PlaceInput(BaseModel):
    id: str
    name: str
    category: str
    lat: float
    lng: float
    distance: int = 0
    address: str = ""
    rating: float = 0.0
    num_reviews: int = 0
    review_rating_count: dict = {}
    hours: dict = {}
    awards: list = []
    web_url: str = ""


class DisasterZone(BaseModel):
    """재난 회피 구역 (원형 영역: 중심 좌표 + 반경)."""
    lat:      float
    lng:      float
    radius_m: float = 2000.0


class RouteRequest(BaseModel):
    user_lat: float
    user_lng: float
    places:         list[PlaceInput]
    dest_lat:       Optional[float] = None
    dest_lng:       Optional[float] = None
    disaster_zones: list[DisasterZone] = []
    # 재난구역 제거 시 보충용 예비 장소 (PER_CAT 초과분, TA 평점 없이 전송)
    extra_places:   list[PlaceInput]  = []


class PlaceOutput(BaseModel):
    id: str
    name: str
    category: str
    lat: float
    lng: float
    distance: int
    address: str
    score: float
    rating: float
    num_reviews: int
    web_url: str


class RouteCandidate(BaseModel):
    route_id: int           # 0=A코스 / 1=B코스 / 2=C코스 (피드백 시 사용)
    label: str
    description: str
    emoji: str
    places: list[PlaceOutput]


class RouteResponse(BaseModel):
    routes: list[RouteCandidate]


class MLFeedbackRequest(BaseModel):
    """
    selected_places : 사용자가 고른 코스의 장소 목록
    rejected_places : 선택받지 못한 코스들의 장소 목록 (중복 제거해서 전달)
    """
    selected_places: list[PlaceInput]
    rejected_places: list[PlaceInput]


# ══════════════════════════════════════════════════════════
# 2. 블랙리스트 필터링
# ══════════════════════════════════════════════════════════

# 단어 전체가 이름에 포함돼야 걸리는 엄격 키워드 (오탐 방지)
_EXACT_BLACKLIST: set[str] = {
    "주차장", "파킹", "주차타워",
    "ATM", "현금인출기",
    "편의점", "GS25", "세븐일레븐", "미니스톱",
    "이마트", "홈플러스", "롯데마트",
    "주유소", "충전소", "세차장",
    "구청", "동사무소", "주민센터", "경찰서", "소방서",
    "우체국", "세무서", "법원", "등기소",
    "모텔", "여관", "고시원", "실버타운",
    "어린이집", "유치원",
    "공중화장실", "인력사무소", "경로당",
    "코인세탁", "크린토피아",
    "코인노래방", "인쇄소",
}

# 이름 어디에든 포함되면 거르는 substring 키워드
_SUBSTR_BLACKLIST: list[str] = [
    "저축은행", "농협", "신한은행", "국민은행", "하나은행", "우리은행", "기업은행",
    "새마을금고", "신협",
    "한의원", "치과", "안과", "피부과", "약국",
    "이동통신대리점", "통신대리점", "핸드폰대리점",
    "공인중개사", "부동산중개",
    "세탁소", "코인세탁기",
    "네일샵", "속눈썹",
    "복지관",
    "빨래방",
    "CU편의점", "CU 편의점",
]


def is_blacklisted(name: str) -> bool:
    for kw in _EXACT_BLACKLIST:
        if kw in name:
            return True
    for kw in _SUBSTR_BLACKLIST:
        if kw in name:
            return True
    return False


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 지점 사이의 거리를 미터 단위로 반환 (Haversine 공식)."""
    R = 6_371_000
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_in_any_disaster_zone(place: PlaceInput, zones: list) -> bool:
    """장소가 하나 이상의 재난 구역 안에 있으면 True 반환."""
    return any(
        _haversine_m(place.lat, place.lng, z.lat, z.lng) < z.radius_m
        for z in zones
    )


# ══════════════════════════════════════════════════════════
# 3. 딥러닝 모델 정의
# ══════════════════════════════════════════════════════════

class PlaceScoringNetA(nn.Module):
    """A코스 — 입력 5: [rating, log_reviews, review_quality, awards, open]"""
    def __init__(self):
        super().__init__()
        self.rating_layer = nn.Sequential(nn.Linear(1, 16), nn.ReLU())
        self.review_layer = nn.Sequential(nn.Linear(2, 8),  nn.ReLU())
        self.award_layer  = nn.Sequential(nn.Linear(1, 8),  nn.ReLU())
        self.open_layer   = nn.Sequential(nn.Linear(1, 8),  nn.ReLU())
        self.merge_layer  = nn.Sequential(
            nn.Linear(40, 16), nn.ReLU(),
            nn.Linear(16, 1),  nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        merged = torch.cat([
            self.rating_layer(x[:, 0:1]),
            self.review_layer(x[:, 1:3]),
            self.award_layer(x[:, 3:4]),
            self.open_layer(x[:, 4:5]),
        ], dim=-1)
        return self.merge_layer(merged).squeeze(-1)


class PlaceScoringNetB(nn.Module):
    """B코스 — 입력 6: [rating, log_reviews, review_quality, awards, open, dist_norm]"""
    def __init__(self):
        super().__init__()
        self.rating_layer   = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.review_layer   = nn.Sequential(nn.Linear(2, 8), nn.ReLU())
        self.award_layer    = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.open_layer     = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.distance_layer = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.merge_layer    = nn.Sequential(
            nn.Linear(40, 16), nn.ReLU(),
            nn.Linear(16, 1),  nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        merged = torch.cat([
            self.rating_layer(x[:, 0:1]),
            self.review_layer(x[:, 1:3]),
            self.award_layer(x[:, 3:4]),
            self.open_layer(x[:, 4:5]),
            self.distance_layer(x[:, 5:6]),
        ], dim=-1)
        return self.merge_layer(merged).squeeze(-1)


class PlaceScoringNetC(nn.Module):
    """C코스 — 입력 5: A코스와 동일 구조, 독립 가중치"""
    def __init__(self):
        super().__init__()
        self.rating_layer = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.review_layer = nn.Sequential(nn.Linear(2, 8), nn.ReLU())
        self.award_layer  = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.open_layer   = nn.Sequential(nn.Linear(1, 8), nn.ReLU())
        self.merge_layer  = nn.Sequential(
            nn.Linear(32, 16), nn.ReLU(),
            nn.Linear(16, 1),  nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        merged = torch.cat([
            self.rating_layer(x[:, 0:1]),
            self.review_layer(x[:, 1:3]),
            self.award_layer(x[:, 3:4]),
            self.open_layer(x[:, 4:5]),
        ], dim=-1)
        return self.merge_layer(merged).squeeze(-1)


def _load_model(model: nn.Module, weights_path: str) -> nn.Module:
    """가중치 파일이 있으면 로드, 없으면 랜덤 초기화로 시작."""
    if os.path.exists(weights_path):
        mtime = datetime.fromtimestamp(os.path.getmtime(weights_path)).strftime("%Y-%m-%d %H:%M:%S")
        model.load_state_dict(torch.load(weights_path, map_location="cpu"))
        logger.info("[INIT] %s 로드 완료 (최종 갱신: %s)", os.path.basename(weights_path), mtime)
    else:
        logger.info("[INIT] %s 없음 → 랜덤 초기화", os.path.basename(weights_path))
    return model.eval()


_model_A = _load_model(PlaceScoringNetA(), _WEIGHTS_A)
_model_B = _load_model(PlaceScoringNetB(), _WEIGHTS_B)
_model_C = _load_model(PlaceScoringNetC(), _WEIGHTS_C)


# ══════════════════════════════════════════════════════════
# 4. 특성 추출
# ══════════════════════════════════════════════════════════

CATEGORY_WEIGHT: dict[str, float] = {
    "명소": 1.4, "문화": 1.3, "공원": 1.2,
    "카페": 1.1, "갤러리": 1.1, "거리": 1.0, "식당": 1.0,
}


def is_currently_open(hours: dict) -> Optional[bool]:
    periods = hours.get("periods", [])
    if not periods:
        return None
    now = _now_seoul()
    ta_day = (now.weekday() + 1) % 7
    current_hhmm = int(now.strftime("%H%M"))
    for period in periods:
        open_info  = period.get("open", {})
        close_info = period.get("close", {})
        if open_info.get("day") != ta_day:
            continue
        try:
            open_t  = int(open_info.get("time", "0000"))
            close_t = int(close_info.get("time", "0000"))
        except (ValueError, TypeError):
            continue
        if close_t < open_t:
            if current_hhmm >= open_t or current_hhmm < close_t:
                return True
        else:
            if open_t <= current_hhmm < close_t:
                return True
    return False


def _review_quality(review_rating_count: dict) -> float:
    total = high = 0
    for star, count_str in review_rating_count.items():
        try:
            count = int(count_str)
            total += count
            if star in ("4", "5"):
                high += count
        except (ValueError, TypeError):
            pass
    return high / total if total > 0 else 0.0


def _base_features(place: PlaceInput) -> tuple[float, float, float, float, float]:
    """5차원 공통 특성 (A·C 모델 입력)"""
    open_status = is_currently_open(place.hours)
    return (
        place.rating / 5.0,
        math.log10(place.num_reviews + 1) / 5.0,
        _review_quality(place.review_rating_count),
        min(len(place.awards), 10) / 10.0,
        {True: 1.0, None: 0.5, False: 0.0}[open_status],
    )


def _tensor_5(place: PlaceInput) -> torch.Tensor:
    """A·C 모델용 5차원 텐서 (배치 학습에 사용)"""
    return torch.tensor(list(_base_features(place)), dtype=torch.float32)


def _tensor_6(place: PlaceInput) -> torch.Tensor:
    """B 모델용 6차원 텐서 (배치 학습에 사용)"""
    feats = _base_features(place)
    return torch.tensor([*feats, min(place.distance, 5000) / 5000.0], dtype=torch.float32)


# ══════════════════════════════════════════════════════════
# 5. 지리 거리 계산 (GeoDataFrame, UTM 미터)
# ══════════════════════════════════════════════════════════

def build_geodataframe(
    places: list[PlaceInput],
    user_lat: float,
    user_lng: float,
) -> gpd.GeoDataFrame:
    rows = [{"idx": 0, "lat": user_lat, "lng": user_lng}]
    for i, p in enumerate(places, start=1):
        rows.append({"idx": i, "lat": p.lat, "lng": p.lng})
    gdf = gpd.GeoDataFrame(
        rows,
        geometry=[Point(r["lng"], r["lat"]) for r in rows],
        crs="EPSG:4326",
    )
    return gdf.to_crs("EPSG:32652")


def compute_distance_matrix(gdf: gpd.GeoDataFrame) -> np.ndarray:
    n = len(gdf)
    dist_matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            d = gdf.geometry.iloc[i].distance(gdf.geometry.iloc[j])
            dist_matrix[i][j] = dist_matrix[j][i] = d
    return dist_matrix


# ══════════════════════════════════════════════════════════
# 6. Dijkstra + Held-Karp TSP (꼬임 없는 최단 경로)
# ══════════════════════════════════════════════════════════

def _build_nx_graph(dist_matrix: np.ndarray) -> nx.Graph:
    n = dist_matrix.shape[0]
    G = nx.Graph()
    G.add_nodes_from(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            G.add_edge(i, j, weight=float(dist_matrix[i][j]))
    return G


def _dijkstra_held_karp(
    G: nx.Graph,
    user_node: int,
    place_nodes: list[int],
) -> list[int]:
    n = len(place_nodes)
    if n == 0:
        return []
    if n == 1:
        return place_nodes[:]

    all_nodes = [user_node] + place_nodes
    shortest: dict[int, dict[int, float]] = {
        src: dict(nx.single_source_dijkstra_path_length(G, src))
        for src in all_nodes
    }

    INF = float("inf")

    def d(a: int, b: int) -> float:
        return shortest.get(a, {}).get(b, INF)

    dp:     dict[tuple[int, int], float] = {}
    parent: dict[tuple[int, int], int]   = {}

    for i, node in enumerate(place_nodes):
        dp[(1 << i, i)]     = d(user_node, node)
        parent[(1 << i, i)] = -1

    for mask in range(1, 1 << n):
        for last_i in range(n):
            if not (mask & (1 << last_i)):
                continue
            state = (mask, last_i)
            if state not in dp:
                continue
            curr_cost = dp[state]
            for next_i in range(n):
                if mask & (1 << next_i):
                    continue
                new_mask  = mask | (1 << next_i)
                new_cost  = curr_cost + d(place_nodes[last_i], place_nodes[next_i])
                new_state = (new_mask, next_i)
                if new_cost < dp.get(new_state, INF):
                    dp[new_state]     = new_cost
                    parent[new_state] = last_i

    full_mask   = (1 << n) - 1
    best_last_i = min(range(n), key=lambda i: dp.get((full_mask, i), INF))

    if dp.get((full_mask, best_last_i), INF) == INF:
        return place_nodes[:]

    route_indices: list[int] = []
    mask, curr_i = full_mask, best_last_i
    while curr_i != -1:
        route_indices.append(curr_i)
        prev_i = parent[(mask, curr_i)]
        if prev_i != -1:
            mask ^= (1 << curr_i)
        curr_i = prev_i

    route_indices.reverse()
    return [place_nodes[i] for i in route_indices]


def _two_opt(route: list[int], dist: np.ndarray) -> list[int]:
    """TSP 투어용 2-opt (출발점으로 귀환하는 순환 경로)."""
    improved = True
    while improved:
        improved = False
        for i in range(len(route) - 1):
            for j in range(i + 2, len(route)):
                a, b = route[i], route[i + 1] if i + 1 < len(route) else route[0]
                c, d = route[j], route[(j + 1) % len(route)]
                if dist[a][b] + dist[c][d] > dist[a][c] + dist[b][d] + 1e-9:
                    route[i + 1:j + 1] = route[i + 1:j + 1][::-1]
                    improved = True
    return route


def _two_opt_path(route: list[int], dist: np.ndarray) -> list[int]:
    """경로(path)용 2-opt — route[0]·route[-1]을 고정 출발·도착으로 취급."""
    improved = True
    while improved:
        improved = False
        for i in range(len(route) - 2):
            for j in range(i + 2, len(route) - 1):
                a, b = route[i], route[i + 1]
                c, d = route[j], route[j + 1]
                if dist[a][b] + dist[c][d] > dist[a][c] + dist[b][d] + 1e-9:
                    route[i + 1:j + 1] = route[i + 1:j + 1][::-1]
                    improved = True
    return route


def _dijkstra_held_karp_path(
    G: nx.Graph,
    origin_node: int,
    dest_node: int,
    place_nodes: list[int],
) -> list[int]:
    n = len(place_nodes)
    if n == 0:
        return []
    if n == 1:
        return place_nodes[:]

    all_nodes = [origin_node, dest_node] + place_nodes
    shortest: dict[int, dict[int, float]] = {
        src: dict(nx.single_source_dijkstra_path_length(G, src))
        for src in all_nodes
    }

    INF = float("inf")

    def d(a: int, b: int) -> float:
        return shortest.get(a, {}).get(b, INF)

    dp:     dict[tuple[int, int], float] = {}
    parent: dict[tuple[int, int], int]   = {}

    for i, node in enumerate(place_nodes):
        dp[(1 << i, i)]     = d(origin_node, node)
        parent[(1 << i, i)] = -1

    for mask in range(1, 1 << n):
        for last_i in range(n):
            if not (mask & (1 << last_i)):
                continue
            state = (mask, last_i)
            if state not in dp:
                continue
            curr_cost = dp[state]
            for next_i in range(n):
                if mask & (1 << next_i):
                    continue
                new_mask  = mask | (1 << next_i)
                new_cost  = curr_cost + d(place_nodes[last_i], place_nodes[next_i])
                new_state = (new_mask, next_i)
                if new_cost < dp.get(new_state, INF):
                    dp[new_state]     = new_cost
                    parent[new_state] = last_i

    full_mask = (1 << n) - 1
    best_last_i = min(
        range(n),
        key=lambda i: dp.get((full_mask, i), INF) + d(place_nodes[i], dest_node),
    )

    if dp.get((full_mask, best_last_i), INF) == INF:
        return place_nodes[:]

    route_indices: list[int] = []
    mask, curr_i = full_mask, best_last_i
    while curr_i != -1:
        route_indices.append(curr_i)
        prev_i = parent[(mask, curr_i)]
        if prev_i != -1:
            mask ^= (1 << curr_i)
        curr_i = prev_i

    route_indices.reverse()
    return [place_nodes[i] for i in route_indices]


def optimize_route(
    places: list[PlaceInput],
    user_lat: float,
    user_lng: float,
) -> list[PlaceInput]:
    """추천 탭용: 출발지 고정, 도착지 미지정 TSP 최적화."""
    if len(places) <= 1:
        return places

    gdf         = build_geodataframe(places, user_lat, user_lng)
    dist_matrix = compute_distance_matrix(gdf)
    G           = _build_nx_graph(dist_matrix)

    place_nodes = list(range(1, len(places) + 1))
    hk_route    = _dijkstra_held_karp(G, 0, place_nodes)

    full_route  = [0] + hk_route
    opt_route   = _two_opt(full_route, dist_matrix)
    final_nodes = [nd for nd in opt_route if nd != 0]

    return [places[node - 1] for node in final_nodes if 1 <= node <= len(places)]


def optimize_route_with_dest(
    places: list[PlaceInput],
    user_lat: float,
    user_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> list[PlaceInput]:
    """직접 입력 탭용: 출발지·도착지 고정 경로 최적화."""
    if len(places) <= 1:
        return places

    n = len(places)
    rows = [{"idx": 0, "lat": user_lat, "lng": user_lng}]
    for i, p in enumerate(places, start=1):
        rows.append({"idx": i, "lat": p.lat, "lng": p.lng})
    rows.append({"idx": n + 1, "lat": dest_lat, "lng": dest_lng})

    gdf = gpd.GeoDataFrame(
        rows,
        geometry=[Point(r["lng"], r["lat"]) for r in rows],
        crs="EPSG:4326",
    ).to_crs("EPSG:32652")

    dist_matrix = compute_distance_matrix(gdf)
    G           = _build_nx_graph(dist_matrix)

    place_nodes = list(range(1, n + 1))
    dest_node   = n + 1

    hk_route = _dijkstra_held_karp_path(G, 0, dest_node, place_nodes)

    full_route = [0] + hk_route + [dest_node]
    opt_route  = _two_opt_path(full_route, dist_matrix)
    final_nodes = opt_route[1:-1]

    return [places[node - 1] for node in final_nodes if 1 <= node <= n]


# ══════════════════════════════════════════════════════════
# 7. 장소 점수 계산
# ══════════════════════════════════════════════════════════

def compute_place_score(
    place: PlaceInput,
    model: nn.Module,
    cat_weights: dict[str, float] | None = None,
) -> float:
    """A·C 코스용 — 5차원 특성으로 점수 계산."""
    weights      = cat_weights if cat_weights is not None else CATEGORY_WEIGHT
    feats        = _base_features(place)
    rating_score = place.rating * math.log10(place.num_reviews + 1) if place.rating > 0 else 0.0
    cat_weight   = weights.get(place.category, 1.0)
    award_count  = len(place.awards)
    x = torch.tensor(list(feats), dtype=torch.float32)
    with torch.no_grad():
        nn_quality = model(x.unsqueeze(0)).item()
    return round((nn_quality * rating_score * cat_weight) + (award_count * 0.5), 6)


def compute_place_score_b(
    place: PlaceInput,
    model: PlaceScoringNetB,
    cat_weights: dict[str, float] | None = None,
) -> float:
    """B 코스용 — 6차원 특성으로 점수 계산."""
    weights      = cat_weights if cat_weights is not None else CATEGORY_WEIGHT
    feats        = _base_features(place)
    dist_norm    = min(place.distance, 5000) / 5000.0
    rating_score = place.rating * math.log10(place.num_reviews + 1) if place.rating > 0 else 0.0
    cat_weight   = weights.get(place.category, 1.0)
    award_count  = len(place.awards)
    x = torch.tensor([*feats, dist_norm], dtype=torch.float32)
    with torch.no_grad():
        nn_quality = model(x.unsqueeze(0)).item()
    return round((nn_quality * rating_score * cat_weight) + (award_count * 0.5), 6)


# ══════════════════════════════════════════════════════════
# 8. 코스별 장소 선정
# ══════════════════════════════════════════════════════════

MAX_PLACES = 5

_SIGHT_CATS = {"명소", "문화", "갤러리", "공원", "거리"}
_FOOD_CATS  = {"식당", "카페"}

_W_SIGHT = {"명소": 2.0, "문화": 1.8, "갤러리": 1.5, "공원": 1.3,
            "거리": 0.8, "카페": 0.3, "식당": 0.2}
_W_FOOD  = {"식당": 2.2, "카페": 1.8, "명소": 0.8, "문화": 0.6,
            "공원": 0.5, "갤러리": 0.5, "거리": 0.4}
_W_BAL   = {"명소": 1.4, "식당": 1.3, "카페": 1.2, "문화": 1.2,
            "공원": 1.1, "갤러리": 1.0, "거리": 0.9}


def select_sightseeing(df: pd.DataFrame) -> pd.DataFrame:
    sight_df = df[df["category"].isin(_SIGHT_CATS)]
    pool     = sight_df if len(sight_df) >= 3 else df
    return pool.nlargest(MAX_PLACES, "final_score")


def select_food_tour(df: pd.DataFrame) -> pd.DataFrame:
    food_df  = df[df["category"].isin(_FOOD_CATS)].nlargest(3, "final_score")
    food_ids = set(food_df["id"])
    sight_df = df[df["category"].isin(_SIGHT_CATS) & ~df["id"].isin(food_ids)]
    sight_df = sight_df.nlargest(MAX_PLACES - len(food_df), "final_score")
    result   = pd.concat([food_df, sight_df])
    if len(result) < MAX_PLACES:
        used = set(result["id"])
        extra = df[~df["id"].isin(used)].nlargest(MAX_PLACES - len(result), "final_score")
        result = pd.concat([result, extra])
    return result.head(MAX_PLACES)


def select_balanced(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["efficiency"] = df["final_score"] - df["distance_m"] / 600.0
    by_eff = df.sort_values("efficiency", ascending=False)
    selected_ids: list[str] = []
    used_cats: set[str]     = set()
    for _, row in by_eff.iterrows():
        if len(selected_ids) >= MAX_PLACES:
            break
        if row["category"] not in used_cats:
            selected_ids.append(row["id"])
            used_cats.add(row["category"])
    for _, row in by_eff.iterrows():
        if len(selected_ids) >= MAX_PLACES:
            break
        if row["id"] not in selected_ids:
            selected_ids.append(row["id"])
    return df[df["id"].isin(selected_ids)]


def select_personalized(df: pd.DataFrame) -> pd.DataFrame:
    """학습된 카테고리 가중치 기반 맞춤 선택.
    가중치가 높은 카테고리에서 우선 슬롯을 배정하고, 나머지는 점수 순으로 채운다."""
    weights = load_category_weights()
    # 가중치 내림차순으로 카테고리 우선순위 결정
    priority_cats = sorted(weights.keys(), key=lambda c: weights[c], reverse=True)

    df = df.copy()
    df["efficiency"] = df["final_score"] - df["distance_m"] / 600.0
    selected_ids: list[str] = []

    # 상위 가중치 카테고리부터 각 1슬롯씩 우선 배정
    for cat in priority_cats:
        if len(selected_ids) >= MAX_PLACES:
            break
        best = df[df["category"] == cat].sort_values("efficiency", ascending=False)
        if not best.empty:
            selected_ids.append(best.iloc[0]["id"])

    # 남은 슬롯을 점수 순으로 채움
    by_eff = df.sort_values("efficiency", ascending=False)
    for _, row in by_eff.iterrows():
        if len(selected_ids) >= MAX_PLACES:
            break
        if row["id"] not in selected_ids:
            selected_ids.append(row["id"])

    return df[df["id"].isin(selected_ids)]


COURSES = [
    {
        "route_id":      3,
        "label":         "맞춤 코스",
        "description":   "선택 이력 기반 카테고리 맞춤 추천",
        "emoji":         "⭐",
        "compute_score": lambda p: compute_place_score(p, _model_C, load_category_weights()),
        "select_fn":     select_personalized,
    },
    {
        "route_id":      0,
        "label":         "명소 탐방",
        "description":   "평점 높은 관광명소·문화시설 집중",
        "emoji":         "🏛",
        "compute_score": lambda p: compute_place_score(p, _model_A, _W_SIGHT),
        "select_fn":     select_sightseeing,
    },
    {
        "route_id":      1,
        "label":         "맛집 투어",
        "description":   "맛집·카페 3곳 + 관광명소 2곳",
        "emoji":         "🍜",
        "compute_score": lambda p: compute_place_score_b(p, _model_B, _W_FOOD),
        "select_fn":     select_food_tour,
    },
    {
        "route_id":      2,
        "label":         "반나절 코스",
        "description":   "카테고리 다양 + 거리 효율 고려",
        "emoji":         "☀️",
        "compute_score": lambda p: compute_place_score(p, _model_C, _W_BAL),
        "select_fn":     select_balanced,
    },
]


# ══════════════════════════════════════════════════════════
# 9. 온라인 학습 — BCE 손실 + Adam
# ══════════════════════════════════════════════════════════

def _train_one(
    model: nn.Module,
    pos_tensors: list[torch.Tensor],
    neg_tensors: list[torch.Tensor],
    lr: float,
    steps: int,
    model_name: str = "",
) -> float:
    if not pos_tensors:
        logger.warning("[TRAIN] %s: pos_tensors 없음 — 학습 스킵", model_name)
        return 0.0
    X = torch.stack(pos_tensors + neg_tensors)
    y = torch.tensor(
        [1.0] * len(pos_tensors) + [0.0] * len(neg_tensors),
        dtype=torch.float32,
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    model.train()
    init_loss = final_loss = 0.0
    for step in range(steps):
        optimizer.zero_grad()
        loss = F.binary_cross_entropy(model(X), y)
        loss.backward()
        optimizer.step()
        if step == 0:
            init_loss = loss.item()
        final_loss = loss.item()
    model.eval()
    logger.info(
        "[TRAIN] %s: pos=%d neg=%d  loss %.4f → %.4f  (lr=%.4f steps=%d)",
        model_name, len(pos_tensors), len(neg_tensors), init_loss, final_loss, lr, steps,
    )
    return final_loss


def _update_models_from_feedback(
    selected: list[PlaceInput],
    rejected: list[PlaceInput],
    lr: float = 0.005,
    steps: int = 15,
) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info(
        "[FEEDBACK] %s  갱신 시작 — selected=%d rejected=%d",
        ts, len(selected), len(rejected),
    )

    pos_5 = [_tensor_5(p) for p in selected]
    neg_5 = [_tensor_5(p) for p in rejected]
    pos_6 = [_tensor_6(p) for p in selected]
    neg_6 = [_tensor_6(p) for p in rejected]

    _train_one(_model_A, pos_5, neg_5, lr, steps, "Model-A")
    torch.save(_model_A.state_dict(), _WEIGHTS_A)
    logger.info("[FEEDBACK] Model-A 저장 → %s", _WEIGHTS_A)

    _train_one(_model_B, pos_6, neg_6, lr, steps, "Model-B")
    torch.save(_model_B.state_dict(), _WEIGHTS_B)
    logger.info("[FEEDBACK] Model-B 저장 → %s", _WEIGHTS_B)

    _train_one(_model_C, pos_5, neg_5, lr, steps, "Model-C")
    torch.save(_model_C.state_dict(), _WEIGHTS_C)
    logger.info("[FEEDBACK] Model-C 저장 → %s", _WEIGHTS_C)

    logger.info("[FEEDBACK] 갱신 완료")


# ══════════════════════════════════════════════════════════
# 10. FastAPI 엔드포인트
# ══════════════════════════════════════════════════════════

@router.post("/recommend", response_model=RouteResponse)
async def recommend_routes(req: RouteRequest) -> RouteResponse:
    """3개 코스를 각 독립 MLP로 채점하고 Held-Karp+2-opt로 동선을 최적화합니다."""
    total_input = len(req.places)
    filtered = [p for p in req.places if not is_blacklisted(p.name)]
    removed = total_input - len(filtered)

    logger.info(
        "[RECOMMEND] 입력=%d  블랙리스트 제거=%d  잔여=%d  (lat=%.4f lng=%.4f)",
        total_input, removed, len(filtered), req.user_lat, req.user_lng,
    )
    if removed:
        removed_names = [p.name for p in req.places if is_blacklisted(p.name)]
        logger.debug("[RECOMMEND] 제거된 장소: %s", removed_names)

    # 재난 구역 내 장소 제거 (우회 경로 탐색 시 전달됨)
    removed_by_zone = 0
    if req.disaster_zones:
        before_zone = len(filtered)
        filtered = [p for p in filtered if not is_in_any_disaster_zone(p, req.disaster_zones)]
        removed_by_zone = before_zone - len(filtered)
        if removed_by_zone:
            logger.info(
                "[RECOMMEND] 재난구역 제거=%d  잔여=%d  (zones=%d)",
                removed_by_zone, len(filtered), len(req.disaster_zones),
            )

    # 재난구역 제거 보완: extra_places에서 유효 장소를 보충 (사라진 수만큼)
    if removed_by_zone > 0 and req.extra_places:
        existing_ids = {p.id for p in filtered}
        valid_extras = [
            p for p in req.extra_places
            if not is_blacklisted(p.name)
            and p.id not in existing_ids
            and not is_in_any_disaster_zone(p, req.disaster_zones)
        ]
        # 카카오 평점(rating) 높은 순으로 정렬 후 제거된 수만큼 보충
        valid_extras.sort(key=lambda p: p.rating, reverse=True)
        to_add = valid_extras[:removed_by_zone]
        if to_add:
            filtered.extend(to_add)
            logger.info(
                "[RECOMMEND] 예비 장소 보충=%d/%d  (재난구역 보완)",
                len(to_add), removed_by_zone,
            )

    if not filtered:
        logger.warning("[RECOMMEND] 필터링 후 장소 없음 → 빈 응답 반환")
        return RouteResponse(routes=[])

    place_map: dict[str, PlaceInput] = {p.id: p for p in filtered}
    scaler = MinMaxScaler()
    route_candidates: list[RouteCandidate] = []

    for course in COURSES:
        scores: dict[str, float] = {
            p.id: course["compute_score"](p) for p in filtered
        }
        records = [
            {
                "id": p.id, "name": p.name, "category": p.category,
                "lat": p.lat, "lng": p.lng,
                "distance_m": float(p.distance),
                "address": p.address, "rating": p.rating,
                "num_reviews": p.num_reviews, "web_url": p.web_url,
                "final_score": scores[p.id],
            }
            for p in filtered
        ]
        df = pd.DataFrame(records)

        if df["final_score"].nunique() > 1:
            df["final_score"] = scaler.fit_transform(df[["final_score"]]).flatten()

        rated_df = df[df["final_score"] > 0]
        pool_df  = rated_df if len(rated_df) >= 3 else df
        if pool_df.empty:
            logger.warning("[RECOMMEND] %s: pool 비어있음 — 코스 스킵", course["label"])
            continue

        selected_df = course["select_fn"](pool_df)
        if selected_df.empty:
            logger.warning("[RECOMMEND] %s: selected 비어있음 — 코스 스킵", course["label"])
            continue

        selected_places = [
            place_map[row["id"]]
            for _, row in selected_df.iterrows()
            if row["id"] in place_map
        ]
        if not selected_places:
            logger.warning("[RECOMMEND] %s: place_map 매칭 실패 — 코스 스킵", course["label"])
            continue

        if req.dest_lat is not None and req.dest_lng is not None:
            ordered = optimize_route_with_dest(
                selected_places, req.user_lat, req.user_lng, req.dest_lat, req.dest_lng,
            )
        else:
            ordered = optimize_route(selected_places, req.user_lat, req.user_lng)

        logger.info(
            "[RECOMMEND] %s %s: pool=%d → selected=%d  (rated_pool=%d)",
            course["emoji"], course["label"],
            len(pool_df), len(selected_places), len(rated_df),
        )

        route_candidates.append(RouteCandidate(
            route_id=course["route_id"],
            label=course["label"],
            description=course["description"],
            emoji=course["emoji"],
            places=[
                PlaceOutput(
                    id=p.id, name=p.name, category=p.category,
                    lat=p.lat, lng=p.lng, distance=p.distance,
                    address=p.address,
                    score=float(df.loc[df["id"] == p.id, "final_score"].values[0])
                          if len(df.loc[df["id"] == p.id]) > 0 else 0.0,
                    rating=p.rating, num_reviews=p.num_reviews, web_url=p.web_url,
                )
                for p in ordered
            ],
        ))

    if not route_candidates:
        logger.warning("[RECOMMEND] 모든 코스 생성 실패 — 빈 응답 반환")
    else:
        logger.info("[RECOMMEND] 완료: %d개 코스 반환", len(route_candidates))

    return RouteResponse(routes=route_candidates)


@router.post("/recommend/feedback")
async def route_ml_feedback(req: MLFeedbackRequest):
    """
    사용자가 선택한 코스(selected_places)를 positive,
    선택받지 못한 코스(rejected_places)를 negative로 하여 3개 MLP를 온라인 학습합니다.
    """
    if not req.selected_places:
        logger.warning("[FEEDBACK] selected_places 없음 — 학습 스킵")
        return {"status": "skipped", "reason": "no selected_places"}

    logger.info(
        "[FEEDBACK] 요청 수신: selected=%d  rejected=%d",
        len(req.selected_places), len(req.rejected_places),
    )

    with _MODEL_LOCK:
        _update_models_from_feedback(req.selected_places, req.rejected_places)

    return {
        "status": "ok",
        "trained_on": {
            "positive": len(req.selected_places),
            "negative": len(req.rejected_places),
        },
        "weights_saved": [_WEIGHTS_A, _WEIGHTS_B, _WEIGHTS_C],
    }
