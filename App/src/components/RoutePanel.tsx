// ═══════════════════════════════════════════════════════════
// RoutePanel — 경로 탐색 + 추천 경로 통합 패널
//
// [구조]
//   상단 탭: "추천 경로" | "직접 입력"
//
//   직접 입력 탭:
//     - 출발지/도착지 입력 + 경유지 자동 추천
//     - 경로 탐색 → 지도 폴리라인 + 결과 카드
//
//   추천 경로 탭:
//     - 현위치 기반 후보 경로 3개 카드
//     - 카드 선택 → 지도에 해당 경로 표시
//     - 선택된 경로 상세 결과 카드
// ═══════════════════════════════════════════════════════════

import { type FC, useState, useCallback, useEffect } from "react";
import type { RouteState, RoutePoint, RouteResult, Category, Place } from "../types/type";
import PlaceSearchInput from "./PlaceSearchInput";
import PlaceMarker from "./PlaceMarker";
import type { KakaoMapInstance, KakaoOverlay, KakaoPolyline } from "../types/type_kakao";
import {
  COLOR_BORDER, COLOR_DANGER, COLOR_INACTIVE, COLOR_PRIMARY, COLOR_PRIMARY_LIGHT,
  COLOR_SURFACE, COLOR_TEXT_MAIN, COLOR_TEXT_SUB, COLOR_ORIGIN, COLOR_DEST,
  COLOR_BG, TRAFFIC_COLOR_MAP,
} from "../colors";
import { formatDistance, formatDuration } from "../utils/Utils";
import type { RecommendedPlace, RecommendedRoute } from "../hooks/Userecommendedroute";
import { sendRouteFeedback } from "../hooks/Userecommendedroute";
import { fetchTaDetail, fetchTaLocationId } from "../hooks/Usekakaonearby";

// ── [CONFIG] ──────────────────────────────────────────────

const WAYPOINT_CATS: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },
  { code: "CT1", category: "문화" },
  { code: "CE7", category: "카페" },
  { code: "FD6", category: "식당" },
  { code: "PK6", category: "공원" },
];

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍", 식당: "🍽️"
};

const CATEGORY_COLOR: Record<Category, string> = {
  카페: "#b45309", 갤러리: "#7c3aed", 공원: "#16a34a",
  명소: "#1d4ed8", 문화: "#0e7490",  거리: "#be185d", 식당: "#d97706",
};

/**
 * TripAdvisor API 요청을 배치 단위로 나눠서 순차 실행한다.
 * 한 번에 너무 많은 요청을 동시에 보내면 429 (Too Many Requests) 에러가 발생하므로,
 * batchSize 개씩 묶어서 실행하고 배치 사이마다 delayMs 만큼 대기한다.
 */
async function fetchInBatches<T>(
  fns: (() => Promise<T>)[],
  batchSize = 5,
  delayMs   = 300,
): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < fns.length; i += batchSize) {
    const batch = await Promise.allSettled(fns.slice(i, i + batchSize).map(fn => fn()));
    results.push(...batch.map(r => (r.status === "fulfilled" ? r.value : null)));
    // 마지막 배치가 아니면 딜레이를 줘서 rate limit 초과를 방지한다
    if (i + batchSize < fns.length) await new Promise(res => setTimeout(res, delayMs));
  }
  return results;
}

interface KakaoPlaceItem {
  id: string; place_name: string; address_name: string; x: string; y: string; distance: string;
}

// ── [지도 렌더링] ─────────────────────────────────────────

export const drawOnMap = (
  roads:           RouteResult["roads"],
  waypoints:       { lat: number; lng: number; name: string }[],
  kakaoMapRef:     React.MutableRefObject<KakaoMapInstance | null>,
  polylineListRef: React.MutableRefObject<KakaoPolyline[]>,
  overlayListRef:  React.MutableRefObject<KakaoOverlay[]>,
) => {
  if (!kakaoMapRef.current) return;
  polylineListRef.current.forEach(p => p.setMap(null));
  overlayListRef.current.forEach(o => o.setMap(null));
  polylineListRef.current = []; overlayListRef.current = [];

  roads.forEach(road => {
    const path: object[] = [];
    for (let i = 0; i < road.vertexes.length - 1; i += 2)
      path.push(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
    if (path.length < 2) return;
    polylineListRef.current.push(new window.kakao.maps.Polyline({
      map: kakaoMapRef.current!, path, strokeWeight: 6,
      strokeColor: TRAFFIC_COLOR_MAP[road.traffic_state] ?? TRAFFIC_COLOR_MAP[0],
      strokeOpacity: 0.9, strokeStyle: "solid",
    }));
  });

  const makePin = (lat: number, lng: number, color: string, emoji: string, label: string) => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
    el.innerHTML = `
      <div style="background:#fff;border-radius:8px;padding:3px 8px;margin-bottom:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.12);font-size:11px;font-weight:700;border:1.5px solid ${color};font-family:'Noto Sans KR',sans-serif;">${label}</div>
      <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;">
        <span style="transform:rotate(45deg);font-size:12px;">${emoji}</span>
      </div>`;
    overlayListRef.current.push(new window.kakao.maps.CustomOverlay({
      map: kakaoMapRef.current!, content: el, yAnchor: 1.1, zIndex: 15,
      position: new window.kakao.maps.LatLng(lat, lng),
    }));
  };

  waypoints.forEach((p, i) => makePin(p.lat, p.lng, COLOR_PRIMARY, `${i + 1}`, `${i + 1}. ${p.name}`));

  const bounds = new window.kakao.maps.LatLngBounds();
  roads.forEach(road => {
    for (let i = 0; i < road.vertexes.length - 1; i += 2)
      bounds.extend(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
  });
  kakaoMapRef.current!.setBounds(bounds, 60, 60, 60, 60);
};

// ── [SUB COMPONENTS] ──────────────────────────────────────

// 경로 결과 요약 카드
const RouteResultCard: FC<{
  result:    RouteResult | { distanceMeter: number; durationSec: number; taxiFare: number; tollFare: number; roads: any[] };
  origin:    string;
  dest:      string;
  waypoints: { name: string }[];
}> = ({ result, origin, dest, waypoints }) => (
  <div style={{ background: COLOR_SURFACE, borderRadius: 14, border: `1.5px solid ${COLOR_PRIMARY}`, overflow: "hidden" }}>
    <div style={{ background: COLOR_PRIMARY_LIGHT, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 900, color: COLOR_PRIMARY }}>{formatDuration(result.durationSec)}</div>
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginTop: 2 }}>총 {formatDistance(result.distanceMeter)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        {result.taxiFare > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN }}>🚕 {result.taxiFare.toLocaleString()}원</div>}
        {result.tollFare > 0 && <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginTop: 2 }}>통행료 {result.tollFare.toLocaleString()}원</div>}
      </div>
    </div>
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      {[{ label: origin, isOrigin: true }, ...waypoints.map(w => ({ label: w.name, isOrigin: false })), { label: dest, isOrigin: false }].map((item, i, arr) => (
        <div key={i}>
          {i > 0 && <div style={{ width: 2, height: 10, background: COLOR_BORDER, marginLeft: 3, marginBottom: 6 }} />}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, flexShrink: 0, borderRadius: i === 0 ? "50%" : i === arr.length - 1 ? 2 : "50%", background: i === 0 ? COLOR_ORIGIN : i === arr.length - 1 ? COLOR_DEST : COLOR_PRIMARY }} />
            <div style={{ fontSize: 12, color: COLOR_TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ padding: "8px 16px 14px", display: "flex", gap: 12, flexWrap: "wrap" }}>
      {([0, 1, 2, 3] as const).map(state => (
        <div key={state} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 20, height: 4, borderRadius: 2, background: TRAFFIC_COLOR_MAP[state] }} />
          <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{["원활", "서행", "정체", "매우정체"][state]}</span>
        </div>
      ))}
    </div>
  </div>
);

// 추천 경로 후보 카드
const RouteOptionCard: FC<{
  route:      RecommendedRoute;
  isSelected: boolean;
  onSelect:   () => void;
}> = ({ route, isSelected, onSelect }) => (
  <div
    onClick={onSelect}
    style={{
      borderRadius: 14, border: `2px solid ${isSelected ? COLOR_PRIMARY : COLOR_BORDER}`,
      background: isSelected ? COLOR_PRIMARY_LIGHT : COLOR_SURFACE,
      padding: "14px 16px", cursor: "pointer", transition: "all 0.2s",
      boxShadow: isSelected ? `0 4px 16px ${COLOR_PRIMARY}28` : "0 1px 4px rgba(0,0,0,0.06)",
    }}
  >
    {/* 헤더 */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 20 }}>{route.emoji}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: isSelected ? COLOR_PRIMARY : COLOR_TEXT_MAIN }}>{route.label}</div>
        <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginTop: 1 }}>{route.description}</div>
      </div>
      {isSelected && (
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: COLOR_PRIMARY, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#fff" }}>✓</span>
        </div>
      )}
    </div>

    {/* 거리·시간 요약 */}
    <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
      {route.totalDuration > 0 && (
        <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_PRIMARY }}>{formatDuration(route.totalDuration)}</div>
      )}
      {route.totalDistance > 0 && (
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>{formatDistance(route.totalDistance)}</div>
      )}
      {route.taxiFare > 0 && (
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>🚕 {route.taxiFare.toLocaleString()}원</div>
      )}
    </div>

    {/* 경유지 칩 */}
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {route.places.map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, background: `${CATEGORY_COLOR[p.category]}14`, borderRadius: 8, padding: "3px 8px", border: `1px solid ${CATEGORY_COLOR[p.category]}30` }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: COLOR_TEXT_SUB }}>{i + 1}</span>
          <span style={{ fontSize: 10 }}>{CATEGORY_ICON[p.category]}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: COLOR_TEXT_MAIN, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          {p.rating > 0 && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700 }}>★{p.rating.toFixed(1)}</span>}
        </div>
      ))}
    </div>
  </div>
);

// ── [MAIN COMPONENT] ──────────────────────────────────────

// 안내 시작 시 경로 탐색 컨텍스트 (추천 탭 vs 직접 입력 탭)
export type NavRouteCtx =
  | { type: 'recommend' }
  | { type: 'manual'; origin: RoutePoint; dest: RoutePoint };

interface RoutePanelProps {
  routeState:      RouteState;
  onSetOrigin:     (p: RoutePoint | null) => void;
  onSetDest:       (p: RoutePoint | null) => void;
  onSetResult:     (r: RouteResult | null) => void;
  onSetLoading:    (v: boolean) => void;
  onSetError:      (m: string) => void;
  userLat:         number;
  userLng:         number;
  isServicesReady: boolean;
  kakaoMapRef:     React.MutableRefObject<KakaoMapInstance | null>;
  polylineListRef: React.MutableRefObject<KakaoPolyline[]>;
  overlayListRef:  React.MutableRefObject<KakaoOverlay[]>;
  recRoutes:       RecommendedRoute[];
  recIsLoading:    boolean;
  recError:        string | null;
  recRefetch:      () => void;
  // [NAV] 안내 시작/취소
  isNavigating:       boolean;
  onStartNavigation:  (route: RecommendedRoute, ctx: NavRouteCtx) => void;
  onCancelNavigation: () => void;
  // [DISASTER] 재난 구역 우회 탐색 시 전달 — ML 백엔드가 해당 구역 장소를 제외
  disasterZones?: { lat: number; lng: number; radius_m: number }[];
  // 재난 우회 모달이 열려 있는 동안 true — recRoutes 갱신 시 출발지/도착지 마커 유지
  disasterDetourActive?: boolean;
  // 현재 안내 중인 경로 — 우회 경로 선택 후 카드 강조용
  navRoute?: RecommendedRoute | null;
  // 추천 탭에서 시작한 안내인지 여부 — 마커 갱신 범위 제한
  navIsRecommend?: boolean;
}

// ── [직접 입력용 경로 후보 3개 생성] ─────────────────────
//
// 카카오 장소 검색 + TripAdvisor 평점 보강 후
// POST /api/route/recommend (ML 서버 MLP + Held-Karp+2-opt) 에 위임.
// 반환된 3개 코스 각각 Kakao Directions 호출 (출발지→경유지→도착지).

interface _BackendPlaceOutput {
  id: string; name: string; category: string;
  lat: number; lng: number; distance: number;
  address: string; score: number; rating: number;
  num_reviews: number; web_url: string;
}
interface _BackendCourse {
  route_id: number; label: string; description: string;
  emoji: string; places: _BackendPlaceOutput[];
}

// ── [도보 경로] ───────────────────────────────────────────

interface WalkingRouteData {
  durationSec:   number;
  distanceMeter: number;
  coords:        { lat: number; lng: number }[];
}

const fetchWalkingRoute = async (
  origin: RoutePoint,
  dest:   RoutePoint,
): Promise<WalkingRouteData | null> => {
  try {
    const res = await fetch("/api/tmap/pedestrian", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startX:       String(origin.lng),
        startY:       String(origin.lat),
        endX:         String(dest.lng),
        endY:         String(dest.lat),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        startName:    "S",
        endName:      "E",
        searchOption: "0",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.features?.length) return null;

    const totalTime     = data.features[0]?.properties?.totalTime     ?? 0;
    const totalDistance = data.features[0]?.properties?.totalDistance ?? 0;

    const coords: { lat: number; lng: number }[] = [];
    for (const feature of data.features) {
      if (feature.geometry?.type === "LineString") {
        for (const coord of feature.geometry.coordinates as [number, number][])
          coords.push({ lng: coord[0], lat: coord[1] });
      }
    }
    if (coords.length < 2) return null;
    return { durationSec: totalTime, distanceMeter: totalDistance, coords };
  } catch {
    return null;
  }
};

// Haversine 직선 거리 (m)
const _haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// 점 P에서 선분 AB까지의 수직 거리 (m) — 경로 이탈 필터링용
const _perpDistToSegment = (
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number => {
  const dx = bLng - aLng, dy = bLat - aLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return _haversine(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1, ((pLng - aLng) * dx + (pLat - aLat) * dy) / len2));
  return _haversine(pLat, pLng, aLat + t * dy, aLng + t * dx);
};
const WALK_MPS = 1.25; // 평균 도보 속도 4.5 km/h

// 경유지가 있는 도보 경로 — 구간별 TMAP 호출, 실패 시 직선거리 추정으로 대체
const fetchWalkingLegs = async (
  pts: { lat: number; lng: number; label: string }[],
): Promise<WalkingRouteData | null> => {
  if (pts.length < 2) return null;
  let totalTime = 0, totalDist = 0;
  const coords: { lat: number; lng: number }[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i];
    const to   = pts[i + 1];
    const leg  = await fetchWalkingRoute(
      { lat: from.lat, lng: from.lng, label: from.label },
      { lat: to.lat,   lng: to.lng,   label: to.label   },
    );

    if (leg) {
      totalTime += leg.durationSec;
      totalDist += leg.distanceMeter;
      coords.push(...(i === 0 ? leg.coords : leg.coords.slice(1)));
    } else {
      // TMAP 실패(400·네트워크 등) → Haversine 직선 추정으로 대체
      const dist = _haversine(from.lat, from.lng, to.lat, to.lng);
      totalTime += dist / WALK_MPS;
      totalDist += dist;
      if (i === 0) coords.push({ lat: from.lat, lng: from.lng });
      coords.push({ lat: to.lat, lng: to.lng });
    }
  }

  return coords.length >= 2
    ? { durationSec: Math.round(totalTime), distanceMeter: Math.round(totalDist), coords }
    : null;
};

const drawWalkingRoute = (
  coords:          WalkingRouteData["coords"],
  waypoints:       { lat: number; lng: number; name: string }[],
  kakaoMapRef:     React.MutableRefObject<KakaoMapInstance | null>,
  polylineListRef: React.MutableRefObject<KakaoPolyline[]>,
  overlayListRef:  React.MutableRefObject<KakaoOverlay[]>,
) => {
  if (!kakaoMapRef.current || coords.length < 2) return;
  polylineListRef.current.forEach(p => p.setMap(null));
  overlayListRef.current.forEach(o => o.setMap(null));
  polylineListRef.current = []; overlayListRef.current = [];

  const path = coords.map(c => new window.kakao.maps.LatLng(c.lat, c.lng));
  polylineListRef.current.push(new window.kakao.maps.Polyline({
    map: kakaoMapRef.current!, path,
    strokeWeight: 5, strokeColor: "#3b82f6",
    strokeOpacity: 0.9, strokeStyle: "solid",
  }));

  // 차량 경로와 동일하게 경유지 번호 핀 표시 (도보 테마 색상)
  const WALK_PIN = "#3b82f6";
  waypoints.forEach((p, i) => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
    el.innerHTML = `
      <div style="background:#fff;border-radius:8px;padding:3px 8px;margin-bottom:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.12);font-size:11px;font-weight:700;border:1.5px solid ${WALK_PIN};font-family:'Noto Sans KR',sans-serif;">${i + 1}. ${p.name}</div>
      <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${WALK_PIN};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;">
        <span style="transform:rotate(45deg);font-size:12px;color:#fff;font-weight:700;">${i + 1}</span>
      </div>`;
    overlayListRef.current.push(new window.kakao.maps.CustomOverlay({
      map: kakaoMapRef.current!, content: el, yAnchor: 1.1, zIndex: 15,
      position: new window.kakao.maps.LatLng(p.lat, p.lng),
    }));
  });

  const bounds = new window.kakao.maps.LatLngBounds();
  coords.forEach(c => bounds.extend(new window.kakao.maps.LatLng(c.lat, c.lng)));
  kakaoMapRef.current!.setBounds(bounds, 60, 60, 60, 60);
};


export const buildManualRoutes = async (
  origin:             RoutePoint,
  dest:               RoutePoint,
  disasterZones?:     { lat: number; lng: number; radius_m: number }[],
  preferredCategory?: Category,
): Promise<RecommendedRoute[]> => {
  // ── Step 1: 출발↔도착 중간 지점 기준 카카오 검색
  const midLat = (origin.lat + dest.lat) / 2;
  const midLng = (origin.lng + dest.lng) / 2;
  // 우회 탐색 시 반경 1.5배 확대 → 재난 구역 외부에서 더 많은 장소 수집
  const baseRadius = Math.min(
    Math.round(Math.hypot(origin.lat - dest.lat, origin.lng - dest.lng) * 111000 / 2),
    4000,
  );
  const radius = disasterZones?.length ? Math.min(Math.round(baseRadius * 1.5), 6000) : baseRadius;

  const ps     = new (window.kakao.maps.services as any).Places();
  const center = new window.kakao.maps.LatLng(midLat, midLng);
  const rawPlaces: { item: KakaoPlaceItem; category: Category }[] = [];
  const seenIds = new Set<string>();

  await Promise.all(WAYPOINT_CATS.map(({ code, category }) =>
    new Promise<void>(resolve => {
      ps.categorySearch(code, (result: KakaoPlaceItem[], status: string) => {
        if (status === (window.kakao.maps.services as any).Status.OK) {
          result.forEach(item => {
            if (!seenIds.has(item.id)) { seenIds.add(item.id); rawPlaces.push({ item, category }); }
          });
        }
        resolve();
      }, { location: center, radius: Math.max(radius, 500), sort: "distance" });
    })
  ));

  if (rawPlaces.length === 0) return [];

  // 재난 구역 내 장소를 후보에서 사전 제거 → 해당 슬롯을 구역 외 장소가 채워
  // preferredCategory(코스 유형) 장소를 더 많이 확보
  const safeRaw = disasterZones?.length
    ? rawPlaces.filter(({ item }) => {
        const lat = parseFloat(item.y), lng = parseFloat(item.x);
        return !disasterZones.some(z => _haversine(lat, lng, z.lat, z.lng) <= z.radius_m);
      })
    : rawPlaces;
  const basePlaces = safeRaw.length > 0 ? safeRaw : rawPlaces;

  // 경로 이탈 필터: 출발↔도착 직선에서 너무 벗어난 장소는 제외해 크게 빙 도는 경로 방지
  const directDist = _haversine(origin.lat, origin.lng, dest.lat, dest.lng);
  const filteredPlaces = directDist > 500
    ? (() => {
        const maxPerpDist = Math.min(directDist * 0.45, 2500);
        const filtered = basePlaces.filter(({ item }) =>
          _perpDistToSegment(
            parseFloat(item.y), parseFloat(item.x),
            origin.lat, origin.lng, dest.lat, dest.lng,
          ) <= maxPerpDist
        );
        return filtered.length > 0 ? filtered : basePlaces;
      })()
    : basePlaces;

  // ── Step 2: Tripadvisor 평점 보강 (localStorage 7일 캐시 적용)
  // 추천 탭(Userecommendedroute.ts)과 동일한 ta_${id} 캐시 키를 공유하므로
  // 추천 탭에서 이미 조회된 장소는 API 호출 없이 캐시에서 읽는다.
  const TA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const readTaCache = (id: string): { rating: number; reviews: number } | undefined => {
    try {
      const raw = localStorage.getItem(`ta_${id}`);
      if (!raw) return undefined;
      const { data, ts } = JSON.parse(raw) as { data: { rating: number; reviews: number } | null; ts: number };
      if (Date.now() - ts > TA_CACHE_TTL_MS) { localStorage.removeItem(`ta_${id}`); return undefined; }
      // null로 저장된 실패 결과는 캐시 미스로 처리해 재시도
      if (data === null) { localStorage.removeItem(`ta_${id}`); return undefined; }
      return data;
    } catch { return undefined; }
  };
  const writeTaCache = (id: string, data: { rating: number; reviews: number }) => {
    try { localStorage.setItem(`ta_${id}`, JSON.stringify({ data, ts: Date.now() })); } catch { }
  };

  // 카테고리별 균등 샘플링 (단순 slice로는 빠른 카테고리가 입력을 독점하는 문제 방지)
  // preferredCategory가 지정되면: 해당 카테고리 5배 확대 + 나머지 40%로 축소
  // → 후보 풀의 ~75%를 preferredCategory로 채워 ML 모델이 코스 유형을 유지하도록 강제
  const PER_CAT = 6;
  const byCatMap = new Map<Category, typeof filteredPlaces>();
  for (const raw of filteredPlaces) {
    const arr = byCatMap.get(raw.category) ?? [];
    arr.push(raw);
    byCatMap.set(raw.category, arr);
  }
  const top: typeof filteredPlaces = [];
  const reserveItems: typeof filteredPlaces = [];
  for (const [cat, arr] of byCatMap) {
    const limit = preferredCategory
      ? (cat === preferredCategory ? PER_CAT * 5 : Math.max(1, Math.round(PER_CAT * 0.4)))
      : PER_CAT;
    top.push(...arr.slice(0, limit));
    reserveItems.push(...arr.slice(limit));
  }

  const detailMap = new Map<string, { rating: number; reviews: number } | null | undefined>();
  const needFetch: typeof top = [];
  for (const rawPlace of top) {
    const cached = readTaCache(rawPlace.item.id);
    if (cached !== undefined) detailMap.set(rawPlace.item.id, cached);
    else needFetch.push(rawPlace);
  }
  if (needFetch.length > 0) {
    const idResults = await fetchInBatches(
      needFetch.map(({ item }) => () => fetchTaLocationId(item.place_name, parseFloat(item.y), parseFloat(item.x))),
    );
    const detailResults = await fetchInBatches(
      idResults.map(id => () => (id ? fetchTaDetail(id) : Promise.resolve(null))),
    );
    needFetch.forEach(({ item }, i) => {
      const d = detailResults[i] ?? null;
      // null(API 실패) 결과는 캐시하지 않아 다음 로드 시 재시도 가능하게 함
      if (d !== null) writeTaCache(item.id, d);
      detailMap.set(item.id, d);
    });
  }

  // ── Step 3: ML 서버 PlaceInput 배열 조립
  // item.distance 는 Kakao가 검색 중심(출발↔도착 중간점) 기준으로 반환한 거리.
  // ML 서버 B코스는 "user_lat/lng(출발지)에서 가까운 맛집 우선" 채점에 쓰므로
  // Haversine 으로 출발지 기준 실제 거리를 직접 계산해 덮어쓴다.
  const placeInputs = top.map(({ item, category }) => {
    const d        = detailMap.get(item.id) ?? null;
    const placeLat = parseFloat(item.y);
    const placeLng = parseFloat(item.x);
    const distFromOrigin = Math.round(_haversine(origin.lat, origin.lng, placeLat, placeLng));
    return {
      id:          item.id,
      name:        item.place_name,
      category,
      lat:         placeLat,
      lng:         placeLng,
      distance:    distFromOrigin,
      address:     item.address_name,
      rating:      d?.rating  ?? 0,
      num_reviews: d?.reviews ?? 0,
      web_url:     "",
    };
  });

  // 예비 장소 입력 조립 (TA 평점 미조회 — 재난구역 제거 시 백엔드 보충용)
  const extraPlaceInputs = reserveItems.map(({ item, category }) => {
    const placeLat = parseFloat(item.y);
    const placeLng = parseFloat(item.x);
    return {
      id:          item.id,
      name:        item.place_name,
      category,
      lat:         placeLat,
      lng:         placeLng,
      distance:    Math.round(_haversine(origin.lat, origin.lng, placeLat, placeLng)),
      address:     item.address_name,
      rating:      0,
      num_reviews: 0,
      web_url:     "",
    };
  });

  // ── Step 4: ML 서버 경로 추천 (MLP 채점 + Held-Karp path + 2-opt path)
  //    user_lat/lng = 출발지, dest_lat/lng = 도착지 → 경유지 순서가 일직선에 가깝게 최적화
  let backendRoutes: _BackendCourse[] = [];
  try {
    const mlRes = await fetch("/api/route/recommend", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        user_lat: origin.lat, user_lng: origin.lng,
        dest_lat: dest.lat,   dest_lng: dest.lng,
        places: placeInputs,
        ...(disasterZones?.length ? {
          disaster_zones: disasterZones,
          extra_places:   extraPlaceInputs,
        } : {}),
      }),
    });
    if (!mlRes.ok) throw new Error(`ML 서버 오류: ${mlRes.status}`);
    const mlData: { routes: _BackendCourse[] } = await mlRes.json();
    backendRoutes = mlData.routes ?? [];
  } catch {
    return [];
  }

  if (backendRoutes.length === 0) return [];

  // ── Step 5: 각 코스별 Directions API (출발지 → ML 경유지 순서 → 도착지)
  const results = await Promise.allSettled(
    backendRoutes.map(async course => {
      const orderedPlaces: RecommendedPlace[] = course.places.map(p => ({
        id:           parseInt(p.id, 10),
        name:         p.name,
        category:     p.category as Category,
        rating:       p.rating,
        reviews:      p.num_reviews,
        score:        p.score,
        district:     p.address.split(" ").slice(0, 2).join(" "),
        lat:          p.lat,
        lng:          p.lng,
        distance:     p.distance,
        _ratingScore: p.score,
        _detour:      0,
      }));

      if (orderedPlaces.length === 0) throw new Error("경유지 없음");
      const wps = orderedPlaces.map(p => `${p.lng},${p.lat}`).join("|");
      const params = new URLSearchParams({
        origin:       `${origin.lng},${origin.lat}`,
        destination:  `${dest.lng},${dest.lat}`,
        priority:     "RECOMMEND", car_fuel: "GASOLINE", car_hipass: "false",
        alternatives: "false",     road_details: "false",
        ...(wps ? { waypoints: wps } : {}),
      });
      const dirRes = await fetch(`/api/directions?${params}`);
      if (!dirRes.ok) throw new Error(`Directions API 오류: ${dirRes.status}`);
      const dirData = await dirRes.json();
      const route   = dirData.routes?.[0];
      if (!route || route.result_code !== 0) throw new Error(route?.result_msg ?? "경로 없음");

      return {
        label:         course.label,
        description:   course.description,
        emoji:         course.emoji,
        places:        orderedPlaces,
        totalDistance: route.summary.distance,
        totalDuration: route.summary.duration,
        roads:         route.sections.flatMap((s: any) => s.roads),
        taxiFare:      route.summary.fare.taxi,
        tollFare:      route.summary.fare.toll,
        _ratingScore:  orderedPlaces.reduce((s, p) => s + p._ratingScore, 0) / (orderedPlaces.length || 1),
      } as RecommendedRoute;
    })
  );

  return results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<RecommendedRoute>).value);
};

const RoutePanel: FC<RoutePanelProps> = ({
  routeState, onSetOrigin, onSetDest, onSetResult, onSetLoading, onSetError,
  userLat, userLng, isServicesReady, kakaoMapRef, polylineListRef, overlayListRef,
  recRoutes, recIsLoading, recError, recRefetch,
  isNavigating, onStartNavigation, onCancelNavigation,
  disasterZones, disasterDetourActive = false, navRoute, navIsRecommend = false,
}) => {
  const [panelTab,    setPanelTab]    = useState<"manual" | "recommend">("recommend");
  const [originInput, setOriginInput] = useState<string>("");
  const [destInput,   setDestInput]   = useState<string>("");

  // 현위치 기반 추천 경로 선택
  const [selectedRouteIdx, setSelectedRouteIdx] = useState<number | null>(null);

  // 직접 입력 경로 후보 상태
  const [manualRoutes,      setManualRoutes]      = useState<RecommendedRoute[]>([]);
  const [manualLoading,     setManualLoading]      = useState<boolean>(false);
  const [manualError,       setManualError]        = useState<string | null>(null);
  const [selectedManualIdx, setSelectedManualIdx]  = useState<number | null>(null);

  // 이동 수단 상태 (추천 / 직접 입력 탭 각각)
  const [recTransportMode,    setRecTransportMode]    = useState<"car" | "walk">("car");
  const [recWalkingData,      setRecWalkingData]      = useState<WalkingRouteData | null>(null);
  const [recWalkLoading,      setRecWalkLoading]      = useState<boolean>(false);
  const [manualTransportMode, setManualTransportMode] = useState<"car" | "walk">("car");
  const [manualWalkingData,   setManualWalkingData]   = useState<WalkingRouteData | null>(null);
  const [manualWalkLoading,   setManualWalkLoading]   = useState<boolean>(false);

  // 추천 경로 출발지/도착지 PlaceMarker 상태
  const [recOriginPlace, setRecOriginPlace] = useState<Place | null>(null);
  const [recDestPlace,   setRecDestPlace]   = useState<Place | null>(null);

  // 안내 중인 우회 경로 아코디언 — 이동 수단 토글
  const [navTransportMode, setNavTransportMode] = useState<"car" | "walk">("car");
  const [navWalkingData,   setNavWalkingData]   = useState<WalkingRouteData | null>(null);
  const [navWalkLoading,   setNavWalkLoading]   = useState<boolean>(false);

  // 경로 변경 확인 다이얼로그
  const [confirmRoute, setConfirmRoute] = useState<{ route: RecommendedRoute; ctx: NavRouteCtx } | null>(null);

  useEffect(() => {
    setNavTransportMode("car");
    setNavWalkingData(null);
  }, [navRoute]);

  // 안내 시작 시 카드 선택 상태 즉시 초기화 (추천/직접 입력 탭 공통)
  useEffect(() => {
    if (isNavigating) {
      setSelectedRouteIdx(null);
      setSelectedManualIdx(null);
      setManualTransportMode("car");
      setManualWalkingData(null);
    }
  }, [isNavigating]);

  // 안내 상태·우회 경로 변경 시 추천 탭 마커 갱신; 안내 종료 시 마커 초기화
  useEffect(() => {
    if (!isNavigating) {
      setRecOriginPlace(null);
      setRecDestPlace(null);
      return;
    }
    if (!navRoute || !navIsRecommend) return;
    const dest = navRoute.places[navRoute.places.length - 1] ?? null;
    setRecOriginPlace({
      id: -1, name: "현재 위치", category: "명소", rating: 0,
      reviews: 0, district: "", lat: userLat, lng: userLng, distance: 0,
    });
    setRecDestPlace(dest);
  }, [navRoute, isNavigating, navIsRecommend]); // eslint-disable-line react-hooks/exhaustive-deps

  // 추천 경로 목록이 바뀌면(우회 탐색 결과 수신) 이전 선택 상태 초기화
  // 재난 우회 모달 열림 중이거나 안내 중일 때는 출발지/도착지 마커를 유지한다.
  useEffect(() => {
    setSelectedRouteIdx(null);
    setRecWalkingData(null);
    setRecTransportMode("car");
    if (!disasterDetourActive && !isNavigating) {
      setRecOriginPlace(null);
      setRecDestPlace(null);
    }
  }, [recRoutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 추천 탭: 코스 선택 토글
  const handleSelectRoute = useCallback((idx: number) => {
    if (selectedRouteIdx === idx) {
      setSelectedRouteIdx(null);
      setRecTransportMode("car"); setRecWalkingData(null);
      polylineListRef.current.forEach(p => p.setMap(null));
      overlayListRef.current.forEach(o => o.setMap(null));
      polylineListRef.current = []; overlayListRef.current = [];
      setRecOriginPlace(null); setRecDestPlace(null);
      return;
    }
    const route = recRoutes[idx];
    if (!route) return;
    setSelectedRouteIdx(idx);
    setRecTransportMode("car"); setRecWalkingData(null);
    const dest = route.places[route.places.length - 1];
    setRecOriginPlace({ id: -1, name: "현재 위치", category: "명소", rating: 0, reviews: 0, district: "", lat: userLat, lng: userLng, distance: 0 });
    setRecDestPlace(dest ?? null);
    drawOnMap(route.roads, route.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef);
  }, [recRoutes, selectedRouteIdx, userLat, userLng, kakaoMapRef, polylineListRef, overlayListRef]);

  // ── 추천 탭: 이동 수단 전환
  const handleRecTransport = useCallback(async (mode: "car" | "walk", route: RecommendedRoute) => {
    setRecTransportMode(mode);
    if (mode === "car") {
      drawOnMap(route.roads, route.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef);
      return;
    }
    if (recWalkingData) { drawWalkingRoute(recWalkingData.coords, route.places, kakaoMapRef, polylineListRef, overlayListRef); return; }
    setRecWalkLoading(true);
    const pts = [
      { lat: userLat, lng: userLng, label: "현재 위치" },
      ...route.places.map(p => ({ lat: p.lat, lng: p.lng, label: p.name })),
    ];
    const walking = await fetchWalkingLegs(pts);
    setRecWalkLoading(false);
    if (!walking) { setRecTransportMode("car"); drawOnMap(route.roads, route.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef); return; }
    setRecWalkingData(walking);
    drawWalkingRoute(walking.coords, route.places, kakaoMapRef, polylineListRef, overlayListRef);
  }, [recWalkingData, userLat, userLng, kakaoMapRef, polylineListRef, overlayListRef]);

  // ── 직접 입력 탭: 코스 선택 토글
  const handleSelectManualRoute = useCallback((idx: number) => {
    if (selectedManualIdx === idx) {
      setSelectedManualIdx(null);
      setManualTransportMode("car"); setManualWalkingData(null);
      polylineListRef.current.forEach(p => p.setMap(null));
      overlayListRef.current.forEach(o => o.setMap(null));
      polylineListRef.current = []; overlayListRef.current = [];
      return;
    }
    const route = manualRoutes[idx];
    if (!route) return;
    setSelectedManualIdx(idx);
    setManualTransportMode("car"); setManualWalkingData(null);
    drawOnMap(route.roads, route.places, kakaoMapRef, polylineListRef, overlayListRef);
  }, [selectedManualIdx, manualRoutes, kakaoMapRef, polylineListRef, overlayListRef]);

  // ── 직접 입력 탭: 이동 수단 전환
  const handleManualTransport = useCallback(async (mode: "car" | "walk", route: RecommendedRoute) => {
    const origin = routeState.origin;
    const dest   = routeState.destination;
    setManualTransportMode(mode);
    if (mode === "car") {
      drawOnMap(route.roads, route.places, kakaoMapRef, polylineListRef, overlayListRef);
      return;
    }
    if (manualWalkingData) { drawWalkingRoute(manualWalkingData.coords, route.places, kakaoMapRef, polylineListRef, overlayListRef); return; }
    setManualWalkLoading(true);
    const pts = [
      { lat: origin?.lat ?? 0, lng: origin?.lng ?? 0, label: origin?.label ?? "출발" },
      ...route.places.map(p => ({ lat: p.lat, lng: p.lng, label: p.name })),
      { lat: dest?.lat ?? 0,   lng: dest?.lng ?? 0,   label: dest?.label ?? "도착"  },
    ];
    const walking = await fetchWalkingLegs(pts);
    setManualWalkLoading(false);
    if (!walking) { setManualTransportMode("car"); drawOnMap(route.roads, route.places, kakaoMapRef, polylineListRef, overlayListRef); return; }
    setManualWalkingData(walking);
    drawWalkingRoute(walking.coords, route.places, kakaoMapRef, polylineListRef, overlayListRef);
  }, [manualWalkingData, routeState.origin, routeState.destination, kakaoMapRef, polylineListRef, overlayListRef]);

  // ── 안내 중인 우회 경로: 이동 수단 전환
  const handleNavTransport = useCallback(async (mode: "car" | "walk") => {
    if (!navRoute) return;
    setNavTransportMode(mode);
    if (mode === "car") {
      drawOnMap(navRoute.roads, navRoute.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef);
      return;
    }
    if (navWalkingData) { drawWalkingRoute(navWalkingData.coords, navRoute.places, kakaoMapRef, polylineListRef, overlayListRef); return; }
    setNavWalkLoading(true);
    const pts = [
      { lat: userLat, lng: userLng, label: "현재 위치" },
      ...navRoute.places.map(p => ({ lat: p.lat, lng: p.lng, label: p.name })),
    ];
    const walking = await fetchWalkingLegs(pts);
    setNavWalkLoading(false);
    if (!walking) { setNavTransportMode("car"); drawOnMap(navRoute.roads, navRoute.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef); return; }
    setNavWalkingData(walking);
    drawWalkingRoute(walking.coords, navRoute.places, kakaoMapRef, polylineListRef, overlayListRef);
  }, [navRoute, navWalkingData, userLat, userLng, kakaoMapRef, polylineListRef, overlayListRef]);

  // ── 안내 시작 요청 — 다른 경로 안내 중이면 확인 다이얼로그 표시
  const handleRequestNavigation = useCallback((route: RecommendedRoute, ctx: NavRouteCtx) => {
    if (isNavigating && navRoute && navRoute.label !== route.label) {
      setConfirmRoute({ route, ctx });
    } else {
      onStartNavigation(route, ctx);
    }
  }, [isNavigating, navRoute, onStartNavigation]);

  // ── 직접 입력 탭: 경로 탐색
  const handleSearch = useCallback(async () => {
    const origin = routeState.origin;
    const dest   = routeState.destination;
    if (!origin || !dest) { onSetError("출발지와 도착지를 모두 선택해주세요"); return; }
    setManualLoading(true); setManualError(null); setManualRoutes([]); setSelectedManualIdx(null);
    setManualTransportMode("car"); setManualWalkingData(null);
    onSetError(""); onSetResult(null);
    polylineListRef.current.forEach(p => p.setMap(null)); overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = []; overlayListRef.current = [];
    try {
      const routes = await buildManualRoutes(origin, dest, disasterZones);
      if (routes.length === 0) setManualError("추천 경로를 생성하지 못했어요. 다른 장소를 선택해보세요.");
      else setManualRoutes(routes);
    } catch (e) {
      onSetError((e as Error).message);
    } finally {
      setManualLoading(false);
    }
  }, [routeState.origin, routeState.destination, onSetResult, onSetError, polylineListRef, overlayListRef, disasterZones]);

  const handleUseCurrentLoc = useCallback(() => {
    onSetOrigin({ label: "현재 위치", lat: userLat, lng: userLng });
    setOriginInput("현재 위치");
  }, [userLat, userLng, onSetOrigin]);

  const handleSwap = useCallback(() => {
    const prevOrigin = originInput;
    const prevDest   = destInput;
    setOriginInput(prevDest);
    setDestInput(prevOrigin);
    onSetOrigin(routeState.destination);
    onSetDest(routeState.origin);
    onSetResult(null); setManualRoutes([]); setSelectedManualIdx(null);
    setManualTransportMode("car"); setManualWalkingData(null);
  }, [originInput, destInput, routeState, onSetOrigin, onSetDest, onSetResult]);

  // 탭 전환 시 지도 초기화
  const handlePanelTab = (tab: "manual" | "recommend") => {
    if (isNavigating) onCancelNavigation();
    polylineListRef.current.forEach(p => p.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = []; overlayListRef.current = [];
    setSelectedRouteIdx(null); setSelectedManualIdx(null);
    setRecOriginPlace(null); setRecDestPlace(null);
    setRecTransportMode("car"); setRecWalkingData(null);
    setManualTransportMode("car"); setManualWalkingData(null);
    onSetResult(null);
    setPanelTab(tab);
  };

  const { errorMsg } = routeState;
  const selectedRoute = selectedRouteIdx !== null ? recRoutes[selectedRouteIdx] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 상단 탭 */}
      <div style={{ display: "flex", borderBottom: `1px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, flexShrink: 0 }}>
        {(["recommend", "manual"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => handlePanelTab(tab)}
            style={{
              flex: 1, padding: "11px 0", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: panelTab === tab ? 800 : 500,
              color: panelTab === tab ? COLOR_PRIMARY : COLOR_TEXT_SUB,
              borderBottom: `2.5px solid ${panelTab === tab ? COLOR_PRIMARY : "transparent"}`,
              fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s",
            }}
          >
            {tab === "recommend" ? "⭐ 추천 경로" : "🔍 직접 입력"}
          </button>
        ))}
      </div>

      {/* ── 추천 경로 탭 ── */}
      {panelTab === "recommend" && (
        <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 로딩 */}
          {recIsLoading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0" }}>
              <div style={{ position: "relative", width: 44, height: 44 }}>
                <div style={{ position: "absolute", inset: 0, border: `3px solid ${COLOR_PRIMARY}20`, borderRadius: "50%" }} />
                <div style={{ position: "absolute", inset: 0, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN, marginBottom: 4 }}>경로 후보 분석 중</div>
                <div style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>Tripadvisor 평점을 수집하고 있어요</div>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* 에러 */}
          {!recIsLoading && recError && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 0" }}>
              <span style={{ fontSize: 36 }}>⚠️</span>
              <span style={{ fontSize: 13, color: "#e53e3e", textAlign: "center" }}>{recError}</span>
              <button onClick={recRefetch} style={{ padding: "9px 20px", borderRadius: 10, border: `1.5px solid ${COLOR_PRIMARY}`, background: "transparent", color: COLOR_PRIMARY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>다시 시도</button>
            </div>
          )}

          {/* 후보 경로 카드 목록 */}
          {!recIsLoading && !recError && recRoutes.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB }}>
                  현위치 기반 추천 경로 <span style={{ color: COLOR_PRIMARY }}>{recRoutes.length}개</span>
                </div>
                <button onClick={() => { recRefetch(); setSelectedRouteIdx(null); setRecOriginPlace(null); setRecDestPlace(null); }} style={{background: "#3c76ff", color: "#fff", borderRadius: 5, padding: "2px 8px", border: "1.5px solid transparent", cursor: "pointer", fontSize: 12}}>재추천</button>
              </div>

              {/* 코스 유형 배지 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["🏛 명소 탐방", "🍜 맛집 투어", "☀️ 반나절 코스"].map(label => (
                  <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: COLOR_BG, color: COLOR_TEXT_SUB, border: `1px solid ${COLOR_BORDER}` }}>{label}</span>
                ))}
              </div>

              {/* 후보 카드 — 선택 시 바로 아래 결과 카드 아코디언 표시 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recRoutes.map((route, i) => {
                  // 우회 경로 안내 중이면 label 일치 카드를 선택 상태로 표시
                  // selectedRouteIdx === null 조건을 제거: recRoutes 캐시 복귀 타이밍과 무관하게
                  // isNavigating + 라벨 매칭만으로 navRoute 데이터를 즉시 표시
                  const isNavMatch  = isNavigating && navRoute?.label === route.label;
                  const isSelected  = isNavMatch || selectedRouteIdx === i;
                  // 아코디언 데이터·상태·핸들러: nav match면 navRoute 데이터를, 아니면 route 데이터를 사용
                  const activeRoute        = isNavMatch ? navRoute! : route;
                  const activeTransport    = isNavMatch ? navTransportMode : recTransportMode;
                  const activeWalkLoading  = isNavMatch ? navWalkLoading   : recWalkLoading;
                  const activeWalkingData  = isNavMatch ? navWalkingData    : recWalkingData;
                  const handleTransport    = isNavMatch
                    ? (mode: "car" | "walk") => handleNavTransport(mode)
                    : (mode: "car" | "walk") => handleRecTransport(mode, route);

                  return (
                    <div key={i}>
                      <RouteOptionCard
                        route={isNavMatch ? activeRoute : route}
                        isSelected={isSelected}
                        onSelect={() => !isNavMatch && handleSelectRoute(i)}
                      />
                      {isSelected && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                          {/* 이동 수단 토글 */}
                          <div style={{ display: "flex", gap: 6 }}>
                            {(["car", "walk"] as const).map(mode => (
                              <button
                                key={mode}
                                onClick={() => handleTransport(mode)}
                                disabled={activeWalkLoading && mode === "walk"}
                                style={{
                                  flex: 1, padding: "8px 0", borderRadius: 10, cursor: "pointer",
                                  border: `1.5px solid ${activeTransport === mode ? (mode === "car" ? COLOR_PRIMARY : "#3b82f6") : COLOR_BORDER}`,
                                  background: activeTransport === mode ? (mode === "car" ? COLOR_PRIMARY : "#eff6ff") : "transparent",
                                  color: activeTransport === mode ? (mode === "car" ? "#fff" : "#3b82f6") : COLOR_TEXT_SUB,
                                  fontSize: 12, fontWeight: 700, fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s",
                                }}
                              >
                                {mode === "car" ? "🚗 차량" : activeWalkLoading ? "⏳ 계산 중..." : "🚶 도보"}
                              </button>
                            ))}
                          </div>
                          <RouteResultCard
                            result={{
                              distanceMeter: activeTransport === "car" ? activeRoute.totalDistance : (activeWalkingData?.distanceMeter ?? 0),
                              durationSec:   activeTransport === "car" ? activeRoute.totalDuration : (activeWalkingData?.durationSec   ?? 0),
                              taxiFare:      activeTransport === "car" ? activeRoute.taxiFare      : 0,
                              tollFare:      activeTransport === "car" ? activeRoute.tollFare      : 0,
                              roads:         activeRoute.roads,
                            }}
                            origin="현재 위치"
                            dest={activeRoute.places[activeRoute.places.length - 1]?.name ?? "도착"}
                            waypoints={activeRoute.places.slice(0, -1)}
                          />
                          {isNavigating && navRoute?.label === activeRoute.label ? (
                            <button
                              onClick={onCancelNavigation}
                              style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none", background: COLOR_DANGER, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
                            >
                              ✕ 안내 취소
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRequestNavigation(route, { type: 'recommend' })}
                              style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none", background: COLOR_PRIMARY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
                            >
                              🗺 안내 시작
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "10px 14px", background: COLOR_BG, borderRadius: 10, border: `1px solid ${COLOR_BORDER}` }}>
                <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, lineHeight: 1.6 }}>
                  💡 경로 카드를 선택하면 지도에 경로가 표시돼요.<br />
                  평점은 Tripadvisor 기준이며, 매칭되지 않은 장소는 점수 없이 표시돼요.
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 직접 입력 탭 ── */}
      {panelTab === "manual" && (
        <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 출발지/도착지 */}
          <div style={{ background: COLOR_SURFACE, borderRadius: 14, border: `1px solid ${COLOR_BORDER}` }}>
            <PlaceSearchInput
              externalValue={originInput}
              getDisplayValue={result => result.place_name}
              onConfirm={result => {
                onSetOrigin({ label: result.place_name, lat: Number(result.y), lng: Number(result.x) });
                setOriginInput(result.place_name);
              }}
              onFocusResult={result => {
                if (kakaoMapRef.current) {
                  kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(Number(result.y), Number(result.x)));
                  kakaoMapRef.current.setLevel(3);
                }
              }}
              isServicesReady={isServicesReady}
              placeholder="출발지 검색"
              dotStyle={{ borderRadius: "50%", background: "#22c55e" }}
              rightSlot={<button onClick={handleUseCurrentLoc} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>📍</button>}
              rowStyle={{ padding: "11px 14px", borderBottom: `1px solid ${COLOR_BORDER}` }}
              kakaoMapRef={kakaoMapRef}
              markerColor="#22c55e"
              confirmedPin={routeState.origin?.label === "현재 위치" ? { lat: userLat, lng: userLng, label: "현재 위치" } : null}
            />
            {/* swap 버튼 */}
            <div style={{ position: "relative", height: 0, zIndex: 5 }}>
              <button onClick={handleSwap} style={{ position: "absolute", right: 14, top: -14, width: 28, height: 28, borderRadius: "50%", border: `1px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.08)" }}>↕</button>
            </div>
            <PlaceSearchInput
              externalValue={destInput}
              getDisplayValue={result => result.place_name}
              onConfirm={result => {
                onSetDest({ label: result.place_name, lat: Number(result.y), lng: Number(result.x) });
                setDestInput(result.place_name);
              }}
              onFocusResult={result => {
                if (kakaoMapRef.current) {
                  kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(Number(result.y), Number(result.x)));
                  kakaoMapRef.current.setLevel(3);
                }
              }}
              isServicesReady={isServicesReady}
              placeholder="도착지 검색"
              dotStyle={{ borderRadius: 2, background: COLOR_DEST }}
              rowStyle={{ padding: "11px 14px" }}
              kakaoMapRef={kakaoMapRef}
              markerColor="#ef4444"
            />
          </div>

          {errorMsg && <div style={{ fontSize: 12, color: COLOR_DANGER, fontWeight: 600, paddingLeft: 4 }}>{errorMsg}</div>}

          {/* 경로 탐색 버튼 */}
          <button
            onClick={handleSearch}
            disabled={manualLoading}
            style={{ padding: "12px 0", borderRadius: 12, border: "none", background: manualLoading ? COLOR_INACTIVE : COLOR_PRIMARY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: manualLoading ? "default" : "pointer", fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s" }}
          >
            {manualLoading ? "경로 후보 생성 중..." : "🔍 경로 추천받기"}
          </button>

          {/* 직접 입력 — 로딩 */}
          {manualLoading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 0", color: COLOR_TEXT_SUB }}>
              <div style={{ width: 28, height: 28, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 13 }}>Tripadvisor 평점으로 경로 후보 생성 중...</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* 직접 입력 — 에러 */}
          {!manualLoading && manualError && (
            <div style={{ fontSize: 12, color: "#e53e3e", fontWeight: 600, textAlign: "center", padding: "8px 0" }}>{manualError}</div>
          )}

          {/* 직접 입력 — 후보 경로 3개 */}
          {!manualLoading && manualRoutes.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB, display: "flex", alignItems: "center", gap: 8 }}>
                <span>추천 경로 <span style={{ color: COLOR_PRIMARY }}>{manualRoutes.length}개</span></span>
                <button
                  onClick={() => {
                    setManualRoutes([]); setSelectedManualIdx(null);
                    setManualTransportMode("car"); setManualWalkingData(null);
                    polylineListRef.current.forEach(p => p.setMap(null)); overlayListRef.current.forEach(o => o.setMap(null));
                    polylineListRef.current = []; overlayListRef.current = [];
                  }}
                  style={{marginLeft: "auto", background: "#3c76ff", color: "#fff", borderRadius: 5, padding: "2px 8px", border: "1.5px solid transparent", cursor: "pointer", fontSize: 12}}>
                  초기화
                </button>
              </div>

              {/* 코스 유형 배지 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["🏛 명소 탐방", "🍜 맛집 투어", "☀️ 반나절 코스"].map(label => (
                  <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: COLOR_BG, color: COLOR_TEXT_SUB, border: `1px solid ${COLOR_BORDER}` }}>{label}</span>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* 코스 카드 — 선택 시 아코디언으로 결과 + 안내 시작 표시 */}
                {manualRoutes.map((route, i) => {
                  // 직접 입력 우회 경로 안내 중이면 label 일치 카드에 navRoute 데이터 표시
                  const isManualNavMatch = isNavigating && !navIsRecommend && navRoute?.label === route.label;
                  const activeManualRoute = isManualNavMatch ? navRoute! : route;
                  return (
                  <div key={i}>
                    <RouteOptionCard
                      route={isManualNavMatch ? activeManualRoute : route}
                      isSelected={isManualNavMatch || selectedManualIdx === i}
                      onSelect={() => !isManualNavMatch && handleSelectManualRoute(i)}
                    />
                    {(isManualNavMatch || selectedManualIdx === i) && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* 이동 수단 토글 */}
                        <div style={{ display: "flex", gap: 6 }}>
                          {(["car", "walk"] as const).map(mode => (
                            <button
                              key={mode}
                              onClick={() => handleManualTransport(mode, activeManualRoute)}
                              disabled={manualWalkLoading && mode === "walk"}
                              style={{
                                flex: 1, padding: "8px 0", borderRadius: 10, cursor: "pointer",
                                border: `1.5px solid ${manualTransportMode === mode ? (mode === "car" ? COLOR_PRIMARY : "#3b82f6") : COLOR_BORDER}`,
                                background: manualTransportMode === mode ? (mode === "car" ? COLOR_PRIMARY : "#eff6ff") : "transparent",
                                color: manualTransportMode === mode ? (mode === "car" ? "#fff" : "#3b82f6") : COLOR_TEXT_SUB,
                                fontSize: 12, fontWeight: 700, fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s",
                              }}
                            >
                              {mode === "car" ? "🚗 차량" : manualWalkLoading ? "⏳ 계산 중..." : "🚶 도보"}
                            </button>
                          ))}
                        </div>
                        <RouteResultCard
                          result={{
                            distanceMeter: manualTransportMode === "car" ? activeManualRoute.totalDistance : (manualWalkingData?.distanceMeter ?? 0),
                            durationSec:   manualTransportMode === "car" ? activeManualRoute.totalDuration : (manualWalkingData?.durationSec ?? 0),
                            taxiFare:      manualTransportMode === "car" ? activeManualRoute.taxiFare : 0,
                            tollFare:      manualTransportMode === "car" ? activeManualRoute.tollFare : 0,
                            roads:         activeManualRoute.roads,
                          }}
                          origin={routeState.origin?.label ?? "출발"}
                          dest={routeState.destination?.label ?? "도착"}
                          waypoints={activeManualRoute.places}
                        />
                        {isNavigating && navRoute?.label === activeManualRoute.label ? (
                          <button
                            onClick={onCancelNavigation}
                            style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none", background: COLOR_DANGER, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
                          >
                            ✕ 안내 취소
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              sendRouteFeedback(activeManualRoute, manualRoutes.filter((_, j) => j !== i));
                              handleRequestNavigation(activeManualRoute, {
                                type:   'manual',
                                origin: routeState.origin!,
                                dest:   routeState.destination!,
                              });
                            }}
                            style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none", background: COLOR_PRIMARY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
                          >
                            🗺 안내 시작
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              <div style={{ padding: "10px 14px", background: COLOR_BG, borderRadius: 10, border: `1px solid ${COLOR_BORDER}` }}>
                <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, lineHeight: 1.6 }}>
                  💡 경로 카드를 선택하면 지도에 경로가 표시돼요.<br />
                  평점은 Tripadvisor 기준이며, 매칭되지 않은 장소는 점수 없이 표시돼요.
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 추천 경로 출발지/도착지 PlaceMarker */}
      {recOriginPlace && (
        <PlaceMarker
          place={recOriginPlace}
          isSelected={true}
          isActive={true}
          isDeemphasized={false}
          kakaoMapRef={kakaoMapRef}
          onSelectPlace={() => {}}
          pinColor="#22c55e"
          hideCategoryIcon={true}
        />
      )}
      {recDestPlace && (
        <PlaceMarker
          place={recDestPlace}
          isSelected={true}
          isActive={true}
          isDeemphasized={false}
          kakaoMapRef={kakaoMapRef}
          onSelectPlace={() => {}}
          pinColor={COLOR_DEST}
        />
      )}

      {/* 경로 변경 확인 다이얼로그 */}
      {confirmRoute && (
        <div
          onClick={() => setConfirmRoute(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Noto Sans KR', sans-serif" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 320, background: COLOR_SURFACE, borderRadius: 20, padding: "24px 20px 20px", boxShadow: "0 12px 36px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: COLOR_TEXT_MAIN, textAlign: "center" }}>경로를 변경하시겠습니까?</div>
            <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, textAlign: "center", lineHeight: 1.6 }}>
              현재 <strong style={{ color: COLOR_PRIMARY }}>{navRoute?.label}</strong> 안내가 진행 중입니다.<br />
              <strong style={{ color: COLOR_TEXT_MAIN }}>{confirmRoute.route.label}</strong>(으)로 변경하면 기존 안내가 취소됩니다.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmRoute(null)}
                style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, color: COLOR_TEXT_SUB, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  const { route, ctx } = confirmRoute;
                  setConfirmRoute(null);
                  onCancelNavigation();
                  onStartNavigation(route, ctx);
                }}
                style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: COLOR_PRIMARY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoutePanel;