// ═══════════════════════════════════════════════════════════
// useRecommendedRoute — 평점 기반 추천 경로 후보 3개 생성 훅
//
// [변경] 단일 경로 → 후보 경로 3개 생성
//   후보 A: 명소·문화 중심 (고평점 우선)
//   후보 B: 카페·공원 중심 (거리 가중)
//   후보 C: 카테고리 혼합 (다양성 최대화)
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import type { Place, Category, RouteResult, DirectionsResponse } from "../types/type";

// ── [CONFIG] ──────────────────────────────────────────────

const TA_API_KEY    = import.meta.env.VITE_TRIPADVISOR_API_KEY as string;
const SEARCH_RADIUS = 2000;
const MAX_WP = 5;

const CATEGORY_WEIGHT: Record<Category, number> = {
  명소: 1.4, 문화: 1.3, 공원: 1.2, 카페: 1.1, 갤러리: 1.1, 거리: 1.0,
};

const ALL_KAKAO_CATS: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },
  { code: "CT1", category: "문화" },
  { code: "CE7", category: "카페" },
  { code: "PK6", category: "공원" },
];

// ── [TYPES] ───────────────────────────────────────────────

export interface RecommendedPlace extends Place {
  score:  number;
  taUrl?: string;
  _ratingScore: number;
  _detour: number;
}

export interface RecommendedRoute {
  label:         string;
  description:   string;
  emoji:         string;
  places:        RecommendedPlace[];
  totalDistance: number;
  totalDuration: number;
  roads:         RouteResult["roads"];   // 폴리라인용
  taxiFare:      number;
  tollFare:      number;
  _ratingScore: number;
}

interface KakaoPlaceItem {
  id: string; place_name: string; address_name: string;
  x: string; y: string; distance: string;
}

// ── [UTIL] ────────────────────────────────────────────────

const taUrl = (path: string) =>
  import.meta.env.DEV
    ? `/vite-proxy/tripadvisor/api/v1/${path}`
    : `${import.meta.env.VITE_BACKEND_URL}/api/tripadvisor/${path}`;


// [CONTENT API] Find Search: name(장소명), lat(위도), lng(경도) 이용해 tripadvisor 장소 고유 id (location_id) 가져오기
const fetchTaLocationId = async (name: string, lat: number, lng: number): Promise<string | null> => {
  try {
    const params = new URLSearchParams({ searchQuery: name, latLong: `${lat},${lng}`, language: "ko", key: TA_API_KEY });
    const url = `${taUrl("location/search")}?${params}`;
    const res    = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[TA] location/search ${res.status}`, { name, url, body: text });
      return null;
    }
    const json   = await res.json();
    return json.data?.[0]?.location_id ?? null;
  } catch (e) { console.warn("[TA] location/search exception", e); return null; }
};

// [CONTENT API] Location Details: 앞서 구한 장소 고유 id (location_id)를 이용해 평점, 리뷰, 웹페이지 url 가져오기
const fetchTaDetail = async (location_id: string): Promise<{ rating: number; reviews: number; webUrl: string } | null> => {
  try {
    const params = new URLSearchParams({ language: "ko", key: TA_API_KEY });
    const res    = await fetch(`${taUrl(`location/${location_id}/details`)}?${params}`);
    if (!res.ok) return null;
    const json   = await res.json();
    return { rating: parseFloat(json.rating ?? "0"), reviews: parseInt(json.num_reviews ?? "0", 10), webUrl: json.web_url ?? "" };
  } catch { return null; }
};

/** 점과 선분(출발↔현위치) 간 수직거리 */
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

// 최근접 이웃으로 방문 순서 최적화
const optimizeOrder = (places: RecommendedPlace[], startLat: number, startLng: number): RecommendedPlace[] => {
  const remaining = [...places];
  const ordered: RecommendedPlace[] = [];
  let cur = { lat: startLat, lng: startLng };
  while (remaining.length > 0) {
    let minI = 0; let minD = Infinity;
    remaining.forEach((p, i) => {
      const d = Math.hypot(p.lat - cur.lat, p.lng - cur.lng);
      if (d < minD) { minD = d; minI = i; }
    });
    const next = remaining.splice(minI, 1)[0];
    ordered.push(next);
    cur = next;
  }
  return ordered;
};

// Directions API 호출
const fetchDirections = async (
  places: RecommendedPlace[], userLat: number, userLng: number,
): Promise<{ distance: number; duration: number; roads: RouteResult["roads"]; taxiFare: number; tollFare: number }> => {
  try {
    if (places.length === 0) return { distance: 0, duration: 0, roads: [], taxiFare: 0, tollFare: 0 };
    const dest = places[places.length - 1];
    const wps  = places.slice(0, -1).map(p => `${p.lng},${p.lat}`).join("|");
    const params = new URLSearchParams({
      origin: `${userLng},${userLat}`, destination: `${dest.lng},${dest.lat}`,
      priority: "RECOMMEND", car_fuel: "GASOLINE", car_hipass: "false",
      alternatives: "false", road_details: "false",
      ...(wps ? { waypoints: wps } : {}),
    });
    const res = await fetch(`${import.meta.env.VITE_KAKAO_DIRECTIONS_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${import.meta.env.VITE_KAKAO_REST_API_KEY}` },
    });
    if (!res.ok) return { distance: 0, duration: 0, roads: [], taxiFare: 0, tollFare: 0 };
    const data: DirectionsResponse = await res.json();
    const route = data.routes?.[0];
    if (!route || route.result_code !== 0) return { distance: 0, duration: 0, roads: [], taxiFare: 0, tollFare: 0 };
    return {
      distance: route.summary.distance, duration: route.summary.duration,
      roads: route.sections.flatMap(s => s.roads),
      taxiFare: route.summary.fare.taxi, tollFare: route.summary.fare.toll,
    };
  } catch { return { distance: 0, duration: 0, roads: [], taxiFare: 0, tollFare: 0 }; }
};

// ── [코스별 선정 로직] ─────────────────────────────────────
//
// A코스 — 순수 고평점 TOP5
//   rating × log(reviews) 점수 내림차순
//   → 가장 검증된 장소 위주
//
// B코스 — 거리 효율 TOP5
//   현위치 기준 거리가 가깝고 동선 내 이탈이 적은 장소 우선
//   정렬 기준: distance/500 - ratingScore (작을수록 우선)
//   → 무리 없이 걸어서 다닐 수 있는 코스
//
// C코스 — 카테고리 다양성 TOP5
//   카테고리별 최고점 1개씩 먼저, 나머지 점수 순으로 채움
//   → A·B와 최대한 다른 장소 조합

type EnrichedPlace = RecommendedPlace & { _ratingScore: number; _distance: number };

const selectA = (pool: EnrichedPlace[]): RecommendedPlace[] =>
  [...pool].sort((a, b) => b._ratingScore - a._ratingScore).slice(0, MAX_WP);

const selectB = (pool: EnrichedPlace[]): RecommendedPlace[] =>
  [...pool].sort((a, b) =>
    (a._distance / 500 - a._ratingScore) - (b._distance / 500 - b._ratingScore)
  ).slice(0, MAX_WP);

const selectC = (pool: EnrichedPlace[]): RecommendedPlace[] => {
  const byScore  = [...pool].sort((a, b) => b._ratingScore - a._ratingScore);
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

const COURSES: { label: string; description: string; emoji: string; select: (pool: EnrichedPlace[]) => RecommendedPlace[] }[] = [
  { label: "고평점 코스",    description: "Tripadvisor 평점 TOP 5 장소만 방문",       emoji: "⭐", select: selectA },
  { label: "거리 효율 코스", description: "가깝고 동선 효율이 높은 장소 위주",          emoji: "🗺", select: selectB },
  { label: "다양성 코스",    description: "카테고리별 1위씩 골고루 방문",               emoji: "🎨", select: selectC },
];

// ── [HOOK] ────────────────────────────────────────────────

interface UseRecommendedRouteOptions {
  userLat: number;
  userLng: number;
  enabled: boolean;
}

interface UseRecommendedRouteResult {
  routes:    RecommendedRoute[];   // 후보 3개
  isLoading: boolean;
  error:     string | null;
  refetch:   () => void;
}

export const useRecommendedRoute = ({
  userLat, userLng, enabled,
}: UseRecommendedRouteOptions): UseRecommendedRouteResult => {
  const [routes,    setRoutes]    = useState<RecommendedRoute[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error,     setError]     = useState<string | null>(null);
  const [fetchKey,  setFetchKey]  = useState<number>(0);
  const cancelledRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    if (!window.kakao?.maps?.services) { setError("카카오맵 서비스가 준비되지 않았습니다"); return; }

    const cacheKey = `rec_routes_${userLat.toFixed(4)}_${userLng.toFixed(4)}`;
    const cached   = sessionStorage.getItem(cacheKey);
    if (cached) {
      try { setRoutes(JSON.parse(cached)); return; }
      catch { sessionStorage.removeItem(cacheKey); }
    }

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);
    setRoutes([]);

    const ps     = new (window.kakao.maps.services as any).Places();
    const center = new window.kakao.maps.LatLng(userLat, userLng);

    // ── Step 1: 카카오 카테고리 검색 (병렬)
    let completed = 0;
    const rawPlaces: { item: KakaoPlaceItem; category: Category }[] = [];
    const seenIds  = new Set<string>();

    ALL_KAKAO_CATS.forEach(({ code, category }) => {
      ps.categorySearch(code, (result: KakaoPlaceItem[], status: string) => {
        completed++;
        if (!cancelledRef.current) {
          if (status === (window.kakao.maps.services as any).Status.OK) {
            result.forEach(item => {
              const dist = parseInt(item.distance, 10);
              if (!seenIds.has(item.id) && dist <= SEARCH_RADIUS) {
                seenIds.add(item.id);
                rawPlaces.push({ item, category });
              }
            });
          }
          if (completed === ALL_KAKAO_CATS.length) {
            if (rawPlaces.length === 0) { setError("주변에 추천할 장소가 없어요"); setIsLoading(false); return; }
            buildRoutes(rawPlaces);
          }
        }
      }, { location: center, radius: SEARCH_RADIUS, sort: "distance" });
    });

    // ── Step 2~4: 평점 보강 → 코스 3개 생성 → Directions 호출
    const buildRoutes = async (items: { item: KakaoPlaceItem; category: Category }[]) => {
      // 상위 20개만 Tripadvisor 조회 (API 호출 최소화)
      const candidates = items.slice(0, 20);

      // 장소의 location_id 가져오기
      const idResults = await Promise.allSettled(
        candidates.map(({ item }) => fetchTaLocationId(item.place_name, parseFloat(item.y), parseFloat(item.x)))
      ); console.log(idResults);
      if (cancelledRef.current) return;

      // location_id를 이용해 장소별 평점, 리뷰 수, tripadvisor detail url get
      const detailResults = await Promise.allSettled(
        idResults.map(r => r.status === "fulfilled" && r.value ? fetchTaDetail(r.value) : Promise.resolve(null))
      ); console.log(detailResults);
      if (cancelledRef.current) return;

      // EnrichedPlace 조립 — 코스별 선정에 필요한 _ratingScore, _distance 포함
      const enriched: EnrichedPlace[] = candidates.map(({ item, category }, i) => {
        const detail  = detailResults[i].status === "fulfilled" ? detailResults[i].value : null;
        const rating  = detail?.rating  ?? 0;
        const reviews = detail?.reviews ?? 0;
        const dist    = parseInt(item.distance, 10);
        const ratingScore = rating > 0
          ? rating * (CATEGORY_WEIGHT[category] ?? 1) * Math.log10(reviews + 1)
          : 0;
        return {
          id: parseInt(item.id, 10), name: item.place_name, category,
          rating, reviews, score: ratingScore,
          district: item.address_name.split(" ").slice(0, 2).join(" "),
          lat: parseFloat(item.y), lng: parseFloat(item.x), distance: dist,
          taUrl: detail?.webUrl ?? "",
          _ratingScore: ratingScore,
          _distance:    dist,
        };
      });

      // 평점 있는 곳 우선, 없으면 전체 사용
      const pool = enriched.filter(p => p._ratingScore > 0).length >= 3
        ? enriched.filter(p => p._ratingScore > 0)
        : enriched;

      // 코스별 장소 선정 → 최근접 이웃 순서 최적화 → Directions 병렬 호출
      const routeResults = await Promise.allSettled(
        COURSES.map(async course => {
          const selected = course.select(pool);
          if (selected.length === 0) throw new Error("경유지 없음");
          const ordered  = optimizeOrder(selected, userLat, userLng);
          const dir      = await fetchDirections(ordered, userLat, userLng);
          return {
            label:         course.label,
            description:   course.description,
            emoji:         course.emoji,
            places:        ordered,
            totalDistance: dir.distance,
            totalDuration: dir.duration,
            roads:         dir.roads,
            taxiFare:      dir.taxiFare,
            tollFare:      dir.tollFare,
          } as RecommendedRoute;
        })
      );
      if (cancelledRef.current) return;

      const built = routeResults
        .filter(r => r.status === "fulfilled")
        .map(r => (r as PromiseFulfilledResult<RecommendedRoute>).value);

      sessionStorage.setItem(cacheKey, JSON.stringify(built));
      setRoutes(built);
      setIsLoading(false);
    };

    return () => { cancelledRef.current = true; };
  }, [userLat, userLng, enabled, fetchKey]);

  const refetch = useCallback(() => {
    const cacheKey = `rec_routes_${userLat.toFixed(4)}_${userLng.toFixed(4)}`;
    sessionStorage.removeItem(cacheKey);
    setFetchKey(prev => prev + 1);
  }, [userLat, userLng]);

  return { routes, isLoading, error, refetch };
};