// ═══════════════════════════════════════════════════════════
// useRecommendedRoute — 백엔드 ML 모델 기반 추천 경로 3개 생성
//
// [흐름]
//   1. 카카오 카테고리 검색 (5종 병렬) → 반경 2000m 내 장소 수집
//   2. TripAdvisor 평점 보강 (localStorage 7일 캐시)
//      → FastAPI /api/tripadvisor/* 프록시 경유
//   3. POST /api/route/recommend → 백엔드 MLP 채점 + Held-Karp+2-opt 최적화
//   4. 각 코스별 GET /api/directions → Kakao Directions 프록시 경유 폴리라인 데이터
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import type { Place, Category, RouteResult, DirectionsResponse } from "../types/type";

// ── [CONFIG] ──────────────────────────────────────────────

const SEARCH_RADIUS = 2000;

const ALL_KAKAO_CATS: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },
  { code: "CT1", category: "문화" },
  { code: "CE7", category: "카페" },
  { code: "PK6", category: "공원" },
  { code: "FD6", category: "식당" },
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
  roads:         RouteResult["roads"];
  taxiFare:      number;
  tollFare:      number;
  _ratingScore: number;
}

interface KakaoPlaceItem {
  id: string; place_name: string; address_name: string;
  x: string; y: string; distance: string;
}

// ── [BACKEND API TYPES] ───────────────────────────────────

interface BackendPlaceInput {
  id:          string;
  name:        string;
  category:    string;
  lat:         number;
  lng:         number;
  distance:    number;
  address:     string;
  rating:      number;
  num_reviews: number;
  web_url:     string;
}

interface BackendPlaceOutput {
  id:          string;
  name:        string;
  category:    string;
  lat:         number;
  lng:         number;
  distance:    number;
  address:     string;
  score:       number;
  rating:      number;
  num_reviews: number;
  web_url:     string;
}

interface BackendRouteCandidate {
  route_id:    number;
  label:       string;
  description: string;
  emoji:       string;
  places:      BackendPlaceOutput[];
}

// ── [TA CACHE] ────────────────────────────────────────────
// TripAdvisor 평점 결과를 localStorage에 7일간 캐싱.

type TaDetail = { rating: number; reviews: number; webUrl: string };

const TA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const getTaCache = (kakaoId: string): TaDetail | null | undefined => {
  try {
    const raw = localStorage.getItem(`ta_${kakaoId}`);
    if (!raw) return undefined;
    const { data, ts } = JSON.parse(raw) as { data: TaDetail | null; ts: number };
    if (Date.now() - ts > TA_CACHE_TTL) { localStorage.removeItem(`ta_${kakaoId}`); return undefined; }
    // null로 저장된 실패 결과는 캐시 미스로 처리해 재시도
    if (data === null) { localStorage.removeItem(`ta_${kakaoId}`); return undefined; }
    return data;
  } catch { return undefined; }
};

const setTaCache = (kakaoId: string, data: TaDetail) => {
  try { localStorage.setItem(`ta_${kakaoId}`, JSON.stringify({ data, ts: Date.now() })); } catch { }
};

// ── [URL HELPERS] ─────────────────────────────────────────

const _BASE    = import.meta.env.VITE_BACKEND_URL ?? "";
const backendUrl = (path: string) => `${_BASE}/api${path}`;

// TripAdvisor — 브라우저 직접 호출 (임시)
// 서버 IP가 TripAdvisor WAF에 차단되므로 브라우저 IP로 직접 호출.
const _TA_KEY  = import.meta.env.VITE_TRIPADVISOR_API_KEY ?? "";
const _TA_BASE = "https://api.content.tripadvisor.com/api/v1";
const taUrl = (path: string) => `${_TA_BASE}/${path}`;

// ── [FEEDBACK] ───────────────────────────────────────────
// 사용자가 코스를 선택(안내 시작)하면 두 피드백 엔드포인트를 fire-and-forget으로 호출.
//   POST /api/route/recommend/feedback → MLP 가중치(weights_A/B/C.pt) 온라인 학습
//   POST /api/route/feedback           → 카테고리 가중치(category_weights.json) EMA 갱신

export const sendRouteFeedback = (
  selectedRoute: RecommendedRoute,
  rejectedRoutes: RecommendedRoute[],
): void => {
  const toInput = (p: RecommendedPlace): BackendPlaceInput => ({
    id:          String(p.id),
    name:        p.name,
    category:    p.category,
    lat:         p.lat,
    lng:         p.lng,
    distance:    p.distance,
    address:     p.district,
    rating:      p.rating,
    num_reviews: p.reviews,
    web_url:     p.taUrl ?? "",
  });

  const selectedInputs = selectedRoute.places.map(toInput);
  const seen           = new Set(selectedInputs.map(p => p.id));
  const rejectedInputs: BackendPlaceInput[] = [];
  for (const route of rejectedRoutes) {
    for (const place of route.places) {
      const id = String(place.id);
      if (!seen.has(id)) { seen.add(id); rejectedInputs.push(toInput(place)); }
    }
  }

  Promise.allSettled([
    fetch(backendUrl("/route/recommend/feedback"), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ selected_places: selectedInputs, rejected_places: rejectedInputs }),
    }),
    fetch(backendUrl("/route/feedback"), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ selected_categories: selectedRoute.places.map(p => p.category) }),
    }),
  ]);
};

const fetchTaLocationId = async (name: string, lat: number, lng: number): Promise<string | null> => {
  try {
    const params = new URLSearchParams({ searchQuery: name, latLong: `${lat},${lng}`, language: "ko", key: _TA_KEY });
    const res    = await fetch(`${taUrl("location/search")}?${params}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json   = await res.json();
    return json.data?.[0]?.location_id ?? null;
  } catch { return null; }
};

const fetchTaDetail = async (location_id: string): Promise<TaDetail | null> => {
  try {
    const params = new URLSearchParams({ language: "ko", key: _TA_KEY });
    const res    = await fetch(`${taUrl(`location/${location_id}/details`)}?${params}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json   = await res.json();
    return { rating: parseFloat(json.rating ?? "0"), reviews: parseInt(json.num_reviews ?? "0", 10), webUrl: json.web_url ?? "" };
  } catch { return null; }
};

// Kakao Directions — FastAPI /api/directions 프록시 경유
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
    const res = await fetch(`${_BASE}/api/directions?${params}`);
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

// ── [HOOK] ────────────────────────────────────────────────

interface UseRecommendedRouteOptions {
  userLat: number;
  userLng: number;
  enabled: boolean;
}

interface UseRecommendedRouteResult {
  routes:    RecommendedRoute[];
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
      try {
        const parsed: RecommendedRoute[] = JSON.parse(cached);
        if (parsed.length > 0 && parsed.every(r => r.roads?.length > 0)) {
          setRoutes(parsed);
          return;
        }
      } catch { }
      sessionStorage.removeItem(cacheKey);
    }

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);
    setRoutes([]);

    const ps     = new (window.kakao.maps.services as any).Places();
    const center = new window.kakao.maps.LatLng(userLat, userLng);

    // ── Step 1: 카카오 카테고리 검색 (5종 병렬)
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

    // ── Step 2~3: TripAdvisor 평점 보강 → 백엔드 ML 추천 → Directions 호출
    const buildRoutes = async (items: { item: KakaoPlaceItem; category: Category }[]) => {
      // 카테고리별 최대 4개씩 균등 샘플링 (특정 카테고리 독점 방지)
      const PER_CAT = 4;
      const byCat = new Map<Category, { item: KakaoPlaceItem; category: Category }[]>();
      for (const raw of items) {
        const arr = byCat.get(raw.category) ?? [];
        arr.push(raw);
        byCat.set(raw.category, arr);
      }
      const candidates = [...byCat.values()].flatMap(arr => arr.slice(0, PER_CAT));

      // TripAdvisor 평점 — 캐시 히트 시 건너뜀 (429 rate limit 방지)
      const cachedMap = new Map<string, TaDetail | null>();
      const toFetch: { item: KakaoPlaceItem; idx: number }[] = [];
      candidates.forEach(({ item }, idx) => {
        const c = getTaCache(item.id);
        if (c !== undefined) cachedMap.set(item.id, c);
        else toFetch.push({ item, idx });
      });

      if (toFetch.length > 0) {
        // 5개씩 배치 처리 — TripAdvisor rate limit(5 req/s) 방지
        const idResults: (string | null)[] = [];
        for (let i = 0; i < toFetch.length; i += 5) {
          const batch = await Promise.allSettled(
            toFetch.slice(i, i + 5).map(({ item }) =>
              fetchTaLocationId(item.place_name, parseFloat(item.y), parseFloat(item.x))
            )
          );
          idResults.push(...batch.map(r => (r.status === "fulfilled" ? r.value : null)));
          if (i + 5 < toFetch.length) await new Promise(res => setTimeout(res, 300));
          if (cancelledRef.current) return;
        }

        if (cancelledRef.current) return;

        const detailResults: (TaDetail | null)[] = [];
        for (let i = 0; i < idResults.length; i += 5) {
          const batch = await Promise.allSettled(
            idResults.slice(i, i + 5).map(id => (id ? fetchTaDetail(id) : Promise.resolve(null)))
          );
          detailResults.push(...batch.map(r => (r.status === "fulfilled" ? r.value : null)));
          if (i + 5 < idResults.length) await new Promise(res => setTimeout(res, 300));
          if (cancelledRef.current) return;
        }

        if (cancelledRef.current) return;

        toFetch.forEach(({ item }, j) => {
          const d = detailResults[j] ?? null;
          // null(API 실패) 결과는 캐시하지 않아 다음 로드 시 재시도 가능하게 함
          if (d !== null) setTaCache(item.id, d);
          cachedMap.set(item.id, d);
        });
      }

      if (cancelledRef.current) return;

      // 백엔드에 보낼 PlaceInput 배열 조립
      const placeInputs: BackendPlaceInput[] = candidates.map(({ item, category }) => {
        const detail = cachedMap.get(item.id) ?? null;
        return {
          id:          item.id,
          name:        item.place_name,
          category,
          lat:         parseFloat(item.y),
          lng:         parseFloat(item.x),
          distance:    parseInt(item.distance, 10),
          address:     item.address_name,
          rating:      detail?.rating  ?? 0,
          num_reviews: detail?.reviews ?? 0,
          web_url:     detail?.webUrl  ?? "",
        };
      });

      // ── 백엔드 ML 모델 추천 호출 (MLP 채점 + Held-Karp+2-opt 순서 최적화)
      let backendRoutes: BackendRouteCandidate[] = [];
      try {
        const res = await fetch(backendUrl("/route/recommend"), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ user_lat: userLat, user_lng: userLng, places: placeInputs }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data: { routes: BackendRouteCandidate[] } = await res.json();
        backendRoutes = data.routes ?? [];
      } catch (e) {
        if (!cancelledRef.current) {
          setError(`경로 추천 서버 오류: ${(e as Error).message}`);
          setIsLoading(false);
        }
        return;
      }

      if (cancelledRef.current) return;
      if (backendRoutes.length === 0) {
        setError("추천 경로를 생성하지 못했어요. 잠시 후 다시 시도해 주세요.");
        setIsLoading(false);
        return;
      }

      // ── 각 코스별 Kakao Directions (FastAPI 프록시) 호출
      const routeResults = await Promise.allSettled(
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
            taUrl:        p.web_url,
            _ratingScore: p.score,
            _detour:      0,
          }));

          const dir = await fetchDirections(orderedPlaces, userLat, userLng);
          return {
            label:         course.label,
            description:   course.description,
            emoji:         course.emoji,
            places:        orderedPlaces,
            totalDistance: dir.distance,
            totalDuration: dir.duration,
            roads:         dir.roads,
            taxiFare:      dir.taxiFare,
            tollFare:      dir.tollFare,
            _ratingScore:  orderedPlaces.reduce((s, p) => s + p._ratingScore, 0) / (orderedPlaces.length || 1),
          } as RecommendedRoute;
        })
      );

      if (cancelledRef.current) return;

      const built = routeResults
        .filter(r => r.status === "fulfilled")
        .map(r => (r as PromiseFulfilledResult<RecommendedRoute>).value)
        .filter(r => r.roads.length > 0);

      if (built.length > 0) sessionStorage.setItem(cacheKey, JSON.stringify(built));
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
