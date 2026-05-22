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

import { type FC, useState, useCallback } from "react";
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
import { fetchTaDetail, fetchTaLocationId } from "../hooks/Usekakaonearby";

// ── [CONFIG] ──────────────────────────────────────────────

const TA_API_KEY = import.meta.env.VITE_TRIPADVISOR_API_KEY as string;

const WAYPOINT_CATS: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },
  { code: "CT1", category: "문화" },
  { code: "CE7", category: "카페" },
];

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍",
};

const CATEGORY_COLOR: Record<Category, string> = {
  카페: "#b45309", 갤러리: "#7c3aed", 공원: "#16a34a",
  명소: "#1d4ed8", 문화: "#0e7490",  거리: "#be185d",
};

// ── [UTIL] ────────────────────────────────────────────────

const taUrl = (path: string) =>
  import.meta.env.DEV
    ? `/vite-proxy/tripadvisor/api/v1/${path}`
    : `${import.meta.env.VITE_BACKEND_URL}/api/tripadvisor/${path}`;

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

const drawOnMap = (
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
}

// ── [직접 입력용 경로 후보 3개 생성] ─────────────────────
//
// 경유지 최대 5개, 평점 상위 풀에서 선정 방식을 달리해 진짜 다른 3개 경로 생성
//
// A코스 — 순수 고평점 TOP5
//   평점 점수(rating × log(reviews))만으로 정렬, 상위 5개 선택
//   → 가장 유명하고 검증된 장소 위주
//
// B코스 — 거리 효율 TOP5
//   출발↔도착 사이 선분과의 수직거리(이탈도) 최소화 + 평점 보정
//   → 돌아가지 않고 동선 효율이 높은 장소 위주
//
// C코스 — 카테고리 다양성 TOP5
//   카테고리별 1위씩 먼저 채우고 나머지는 점수 순으로 채움
//   → A·B와 최대한 다른 장소 조합

const MAX_WP = 5;
const WEIGHT: Record<Category, number> = { 명소: 1.4, 문화: 1.3, 공원: 1.2, 카페: 1.1, 갤러리: 1.1, 거리: 1.0 };

/** 점(px,py)과 선분(ax,ay)→(bx,by) 사이의 수직거리 */
const pointToSegmentDist = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number => {
  const dx = bx - ax; const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

const buildManualRoutes = async (
  origin: RoutePoint,
  dest:   RoutePoint,
): Promise<RecommendedRoute[]> => {
  // ── Step 1: 출발↔도착 중간 지점 기준 카카오 검색
  const midLat = (origin.lat + dest.lat) / 2;
  const midLng = (origin.lng + dest.lng) / 2;
  const radius = Math.min(
    Math.round(Math.hypot(origin.lat - dest.lat, origin.lng - dest.lng) * 111000 / 2),
    4000,
  );
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

  // ── Step 2: Tripadvisor 평점 보강
  // 한 번에 모두 요청하면 429 rate limit에 걸리므로 fetchInBatches로 5개씩 나눠서 조회한다
  const top       = rawPlaces.slice(0, 20);
  const idResults = await fetchInBatches(
    top.map(({ item }) => () => fetchTaLocationId(item.place_name, parseFloat(item.y), parseFloat(item.x))),
  );
  const detailResults = await fetchInBatches(
    idResults.map(id => () => (id ? fetchTaDetail(id) : Promise.resolve(null))),
  );

  const enriched: RecommendedPlace[] = top.map(({ item, category }, i) => {
    const d       = detailResults[i]; // fetchInBatches는 값 자체(T | null)를 반환한다
    const rating  = d?.rating  ?? 0;
    const reviews = d?.reviews ?? 0;
    const dist    = parseInt(item.distance, 10);
    // 기본 평점 점수 (평점 × 카테고리가중치 × log(리뷰수))
    const ratingScore = rating > 0 ? rating * WEIGHT[category] * Math.log10(reviews + 1) : 0;
    // 동선 이탈도 (출발↔도착 선분과의 거리, 작을수록 좋음)
    const detour = pointToSegmentDist(
      parseFloat(item.y), parseFloat(item.x),
      origin.lat, origin.lng,
      dest.lat,   dest.lng,
    ) * 111000; // 도 → 미터 근사

    return {
      id: parseInt(item.id, 10), name: item.place_name, category,
      rating, reviews,
      score: ratingScore,          // A코스 기준
      district: item.address_name.split(" ").slice(0, 2).join(" "),
      lat: parseFloat(item.y), lng: parseFloat(item.x), distance: dist,
      // 추가 필드 (선정 시에만 사용)
      _detour: detour,
      _ratingScore: ratingScore,
    } as RecommendedPlace & { _detour: number; _ratingScore: number };
  }) as (RecommendedPlace & { _detour: number; _ratingScore: number })[];

  // 평점 있는 곳만 사용 (없으면 거리 가까운 순으로 대체)
  const scored  = enriched.filter(p => p._ratingScore > 0);
  const fallback = scored.length >= 3 ? scored : enriched;

  // ── Step 3: 코스별 선정 로직
  // [A] 순수 고평점 TOP5 — 평점 점수 내림차순
  const selectA = (): RecommendedPlace[] =>
    [...fallback]
      .sort((a, b) => b._ratingScore - a._ratingScore)
      .slice(0, MAX_WP);

  // [B] 거리 효율 TOP5 — 이탈도 최소 + 평점 보정
  //     정렬 기준: (이탈도 / 500m) - 평점점수  (작을수록 우선)
  const selectB = (): RecommendedPlace[] =>
    [...fallback]
      .sort((a, b) => {
        const scoreA = (a._detour / 500) - a._ratingScore;
        const scoreB = (b._detour / 500) - b._ratingScore;
        return scoreA - scoreB;
      })
      .slice(0, MAX_WP);

  // [C] 카테고리 다양성 TOP5 — 카테고리별 최고점 1개씩, 나머지 점수 순
  const selectC = (): RecommendedPlace[] => {
    const byScore  = [...fallback].sort((a, b) => b._ratingScore - a._ratingScore);
    const selected: RecommendedPlace[] = [];
    const usedCats = new Set<Category>();
    for (const p of byScore) {
      if (selected.length >= MAX_WP) break;
      if (!usedCats.has(p.category)) { usedCats.add(p.category); selected.push(p); }
    }
    for (const p of byScore) {
      if (selected.length >= MAX_WP) break;
      if (!selected.find(s => s.id === p.id)) selected.push(p);
    }
    return selected;
  };

  const COURSES: { label: string; description: string; emoji: string; places: RecommendedPlace[] }[] = [
    { label: "고평점 코스",    description: "Tripadvisor 평점 TOP 5 장소만 방문",      emoji: "⭐", places: selectA() },
    { label: "동선 효율 코스", description: "돌아가지 않고 경로 위 평점 높은 장소 위주", emoji: "🗺", places: selectB() },
    { label: "다양성 코스",    description: "카테고리별 1위씩 골고루 방문",              emoji: "🎨", places: selectC() },
  ];

  // ── Step 4: Directions API 병렬 호출
  const results = await Promise.allSettled(
    COURSES.map(async course => {
      if (course.places.length === 0) throw new Error("경유지 없음");
      const wps    = course.places.map(p => `${p.lng},${p.lat}`).join("|");
      const params = new URLSearchParams({
        origin:       `${origin.lng},${origin.lat}`,
        destination:  `${dest.lng},${dest.lat}`,
        priority:     "RECOMMEND", car_fuel: "GASOLINE", car_hipass: "false",
        alternatives: "false",     road_details: "false",
        ...(wps ? { waypoints: wps } : {}),
      });
      const res = await fetch(`${import.meta.env.VITE_KAKAO_DIRECTIONS_URL}?${params}`, {
        headers: { Authorization: `KakaoAK ${import.meta.env.VITE_KAKAO_REST_API_KEY}` },
      });
      if (!res.ok) throw new Error(`Directions API 오류: ${res.status}`);
      const data  = await res.json();
      const route = data.routes?.[0];
      if (!route || route.result_code !== 0) throw new Error(route?.result_msg ?? "경로 없음");

      return {
        label:         course.label,
        description:   course.description,
        emoji:         course.emoji,
        places:        course.places,
        totalDistance: route.summary.distance,
        totalDuration: route.summary.duration,
        roads:         route.sections.flatMap((s: any) => s.roads),
        taxiFare:      route.summary.fare.taxi,
        tollFare:      route.summary.fare.toll,
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

  // 추천 경로 출발지/도착지 PlaceMarker 상태
  const [recOriginPlace, setRecOriginPlace] = useState<Place | null>(null);
  const [recDestPlace,   setRecDestPlace]   = useState<Place | null>(null);

  // 현위치 기반 추천 경로 카드 선택 → 지도에 표시
  const handleSelectRoute = useCallback((idx: number) => {
    const route = recRoutes[idx];
    if (!route) return;
    setSelectedRouteIdx(idx);
    const dest = route.places[route.places.length - 1];
    setRecOriginPlace({ id: -1, name: "현재 위치", category: "명소", rating: 0, reviews: 0, district: "", lat: userLat, lng: userLng, distance: 0 });
    setRecDestPlace(dest ?? null);
    drawOnMap(route.roads, route.places.slice(0, -1), kakaoMapRef, polylineListRef, overlayListRef);
  }, [recRoutes, userLat, userLng, kakaoMapRef, polylineListRef, overlayListRef]);

  // 직접 입력 후보 경로 선택 → 지도에 표시
  const handleSelectManualRoute = useCallback((idx: number) => {
    const route = manualRoutes[idx];
    if (!route) return;
    setSelectedManualIdx(idx);
    drawOnMap(route.roads, route.places, kakaoMapRef, polylineListRef, overlayListRef);
  }, [manualRoutes, kakaoMapRef, polylineListRef, overlayListRef]);

  // 직접 입력 — 이미 선택된 origin/dest 기준으로 후보 경로 3개 생성
  const handleSearch = useCallback(async () => {
    const origin = routeState.origin;
    const dest   = routeState.destination;
    if (!origin || !dest) { onSetError("출발지와 도착지를 모두 선택해주세요"); return; }
    setManualLoading(true); setManualError(null); setManualRoutes([]); setSelectedManualIdx(null);
    onSetError(""); onSetResult(null);
    polylineListRef.current.forEach(p => p.setMap(null)); overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = []; overlayListRef.current = [];
    try {
      const routes = await buildManualRoutes(origin, dest);
      if (routes.length === 0) setManualError("추천 경로를 생성하지 못했어요. 다른 장소를 선택해보세요.");
      else setManualRoutes(routes);
    } catch (e) {
      onSetError((e as Error).message);
    } finally {
      setManualLoading(false);
    }
  }, [routeState.origin, routeState.destination, onSetResult, onSetError, polylineListRef, overlayListRef]);

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
  }, [originInput, destInput, routeState, onSetOrigin, onSetDest, onSetResult]);

  // 탭 전환 시 지도 초기화
  const handlePanelTab = (tab: "manual" | "recommend") => {
    polylineListRef.current.forEach(p => p.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = []; overlayListRef.current = [];
    setSelectedRouteIdx(null); setSelectedManualIdx(null);
    setRecOriginPlace(null); setRecDestPlace(null);
    onSetResult(null);
    setPanelTab(tab);
  };

  const { errorMsg } = routeState;
  const selectedRoute       = selectedRouteIdx  !== null ? recRoutes[selectedRouteIdx]     : null;
  const selectedManualRoute = selectedManualIdx !== null ? manualRoutes[selectedManualIdx]  : null;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>

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
                <button onClick={() => { recRefetch(); setSelectedRouteIdx(null); setRecOriginPlace(null); setRecDestPlace(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: COLOR_TEXT_SUB, padding: 0 }}>🔄 재추천</button>
              </div>

              {/* 추천 기준 배지 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["⭐ 평점 우선", "📍 거리 고려", "🎨 카테고리 다양성"].map(label => (
                  <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: COLOR_BG, color: COLOR_TEXT_SUB, border: `1px solid ${COLOR_BORDER}` }}>{label}</span>
                ))}
              </div>

              {/* 후보 카드 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recRoutes.map((route, i) => (
                  <RouteOptionCard
                    key={i} route={route}
                    isSelected={selectedRouteIdx === i}
                    onSelect={() => handleSelectRoute(i)}
                  />
                ))}
              </div>

              {/* 선택된 경로 결과 카드 */}
              {selectedRoute && (
                <RouteResultCard
                  result={{ distanceMeter: selectedRoute.totalDistance, durationSec: selectedRoute.totalDuration, taxiFare: selectedRoute.taxiFare, tollFare: selectedRoute.tollFare, roads: selectedRoute.roads }}
                  origin="현재 위치"
                  dest={selectedRoute.places[selectedRoute.places.length - 1]?.name ?? "도착"}
                  waypoints={selectedRoute.places.slice(0, -1)}
                />
              )}

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
                  onClick={() => { setManualRoutes([]); setSelectedManualIdx(null); polylineListRef.current.forEach(p => p.setMap(null)); overlayListRef.current.forEach(o => o.setMap(null)); polylineListRef.current = []; overlayListRef.current = []; }}
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: COLOR_TEXT_SUB, padding: 0 }}
                >
                  초기화
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {manualRoutes.map((route, i) => (
                  <RouteOptionCard
                    key={i} route={route}
                    isSelected={selectedManualIdx === i}
                    onSelect={() => handleSelectManualRoute(i)}
                  />
                ))}
              </div>

              {/* 선택된 경로 결과 카드 */}
              {selectedManualRoute && (
                <RouteResultCard
                  result={{ distanceMeter: selectedManualRoute.totalDistance, durationSec: selectedManualRoute.totalDuration, taxiFare: selectedManualRoute.taxiFare, tollFare: selectedManualRoute.tollFare, roads: selectedManualRoute.roads }}
                  origin={routeState.origin?.label ?? "출발"}
                  dest={routeState.destination?.label ?? "도착"}
                  waypoints={selectedManualRoute.places}
                />
              )}

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
    </div>
  );
};

export default RoutePanel;
