// ═══════════════════════════════════════════════════════════
// useKakaoNearby — 카카오맵 Places + Tripadvisor Reviews 혼합 훅
//
// [흐름]
//   1. 카카오 categorySearch → 주변 장소 목록 (이름·좌표·거리)
//   2. 장소명으로 Tripadvisor Location Search → location_id
//   3. location_id로 Tripadvisor Details → rating·num_reviews
//   4. 카카오 Place에 평점 병합 후 반환
//
// [환경변수]
//   VITE_TRIPADVISOR_API_KEY=your_key
//
// [CORS] Vite 프록시 사용 (vite.config.ts 설정 필요)
//   "/vite-proxy/tripadvisor" → "https://api.content.tripadvisor.com"
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import type { Place, Category } from "../types/type";

// ── [CONFIG] ──────────────────────────────────────────────


const KAKAO_CATEGORY_LIST: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },   // 관광명소
  { code: "CT1", category: "문화" },   // 문화시설
  { code: "CE7", category: "카페" },   // 카페
  { code: "FD6", category: "식당" },   // 음식점
  { code: "PK6", category: "공원" },   // 공원
];

// 반경별 최대 조회 개수: 가까운 곳 10개 / 기본 20개 / 넓은 곳 30개
const getMaxCount = (radiusMeter: number): number => {
  if (radiusMeter <= 250) return 10;
  if (radiusMeter <= 500) return 20;
  return 30;
};

// ── [TYPES] ───────────────────────────────────────────────

interface KakaoPlaceItem {
  id:                  string;
  place_name:          string;
  category_group_code: string;
  address_name:        string;
  x:                   string;   // 경도
  y:                   string;   // 위도
  distance:            string;   // 미터
}

interface TaSearchResponse {
  data?:  { location_id: string; name: string }[];
  error?: { message: string };
}

interface TaDetailResponse {
  rating?:      string;
  num_reviews?: string;
  error?:       { message: string };
}

// ── [UTIL] ────────────────────────────────────────────────

// TripAdvisor API — 브라우저에서 직접 호출 (임시)
// 서버 IP(Docker/EC2)는 TripAdvisor WAF에 의해 403으로 차단되므로
// 브라우저 IP로 직접 호출한다. API 키는 VITE_TRIPADVISOR_API_KEY 환경변수 사용.
//
// [해결 방향 — 백엔드 팀 참고]
//   Option A) 주거용 프록시(residential proxy) 서버 경유 — httpx ProxyTransport 사용
//   Option B) FastAPI 프록시를 없애고 브라우저에서 직접 호출 ← 현재 방식
//             (VITE_TRIPADVISOR_API_KEY 이미 .env에 있음)
//   Option C) TripAdvisor 대신 Google Places API로 교체
//             (서버-서버 호출 정상 동작, 평점·리뷰 동일하게 제공)
const _TA_KEY  = import.meta.env.VITE_TRIPADVISOR_API_KEY ?? "";
const _TA_BASE = "https://api.content.tripadvisor.com/api/v1";
const taUrl = (path: string) => `${_TA_BASE}/${path}`;

export const fetchTaLocationId = async (
  placeName: string,
  lat:       number,
  lng:       number,
): Promise<string | null> => {
  try {
    const params = new URLSearchParams({
      searchQuery: placeName,
      latLong:     `${lat},${lng}`,
      language:    "ko",
      key:         _TA_KEY,
    });
    const res  = await fetch(`${taUrl("location/search")}?${params}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: TaSearchResponse = await res.json();
    return json.data?.[0]?.location_id ?? null;
  } catch {
    return null;
  }
};

export const fetchTaDetail = async (
  locationId: string,
): Promise<{ rating: number; reviews: number } | null> => {
  try {
    const params = new URLSearchParams({ language: "ko", key: _TA_KEY });
    const res    = await fetch(`${taUrl(`location/${locationId}/details`)}?${params}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: TaDetailResponse = await res.json();
    return {
      rating:  parseFloat(json.rating      ?? "0"),
      reviews: parseInt(json.num_reviews   ?? "0", 10),
    };
  } catch {
    return null;
  }
};

// ── [HOOK] ────────────────────────────────────────────────

interface UseKakaoNearbyOptions {
  userLat:     number;
  userLng:     number;
  radiusMeter: number;
  enabled:     boolean;
}

interface UseKakaoNearbyResult {
  placeList:  Place[];
  isLoading:  boolean;
  error:      string | null;
  refetch:    () => void;
}

export const useKakaoNearby = ({
  userLat,
  userLng,
  radiusMeter,
  enabled,
}: UseKakaoNearbyOptions): UseKakaoNearbyResult => {
  const [placeList, setPlaceList] = useState<Place[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error,     setError]     = useState<string | null>(null);
  const [fetchKey,  setFetchKey]  = useState<number>(0);

  const cancelledRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    if (!window.kakao?.maps?.services) {
      setError("카카오맵 서비스가 준비되지 않았습니다");
      return;
    }

    // 세션 캐시 확인
    const cacheKey = `kakao_nearby_${userLat.toFixed(4)}_${userLng.toFixed(4)}_${radiusMeter}`;
    const cached   = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setPlaceList(JSON.parse(cached));
        return;
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);
    setPlaceList([]);

    const ps     = new (window.kakao.maps.services as any).Places();
    const center = new window.kakao.maps.LatLng(userLat, userLng);

    // ── Step 1: 카카오 카테고리 검색 (병렬)
    let completed = 0;
    const rawPlaces: { item: KakaoPlaceItem; category: Category }[] = [];
    const seenIds  = new Set<string>();

    KAKAO_CATEGORY_LIST.forEach(({ code, category }) => {
      ps.categorySearch(
        code,
        (result: KakaoPlaceItem[], status: string) => {
          completed++;

          if (!cancelledRef.current) {
            if (status === (window.kakao.maps.services as any).Status.OK) {
              result.forEach(item => {
                const dist = parseInt(item.distance, 10);
                if (!seenIds.has(item.id) && dist <= radiusMeter) {
                  seenIds.add(item.id);
                  rawPlaces.push({ item, category });
                }
              });
            }

            // 모든 카테고리 검색 완료 → Step 2
            if (completed === KAKAO_CATEGORY_LIST.length) {
              if (rawPlaces.length === 0) {
                setPlaceList([]);
                setIsLoading(false);
                return;
              }
              enrichWithTripadvisor(rawPlaces);
            }
          }
        },
        {
          location: center,
          radius:   radiusMeter,
          sort:     (window.kakao.maps.services as any).SortBy?.DISTANCE ?? "distance",
        },
      );
    });

    // ── Step 2: Tripadvisor로 평점 보강
    const enrichWithTripadvisor = async (
      items: { item: KakaoPlaceItem; category: Category }[],
    ) => {
      const maxCount = getMaxCount(radiusMeter);
      // 카테고리별 균등 분배 후 거리순 재정렬 → maxCount개 선택
      // (카페 등 특정 카테고리가 결과를 독점하지 않도록)
      const perCat = Math.ceil(maxCount / KAKAO_CATEGORY_LIST.length);
      const byCat  = new Map<Category, typeof items>();
      for (const raw of items) {
        const arr = byCat.get(raw.category) ?? [];
        arr.push(raw);
        byCat.set(raw.category, arr);
      }
      const balanced: typeof items = [];
      for (const arr of byCat.values()) {
        arr.sort((a, b) => parseInt(a.item.distance) - parseInt(b.item.distance));
        balanced.push(...arr.slice(0, perCat));
      }
      balanced.sort((a, b) => parseInt(a.item.distance) - parseInt(b.item.distance));
      const top = balanced.slice(0, maxCount);

      // location_id 배치 조회 (5개씩, 300ms 간격 — rate limit 방지)
      const idResults: (string | null)[] = [];
      for (let i = 0; i < top.length; i += 5) {
        const batch = await Promise.allSettled(
          top.slice(i, i + 5).map(({ item }) =>
            fetchTaLocationId(item.place_name, parseFloat(item.y), parseFloat(item.x))
          ),
        );
        idResults.push(...batch.map(r => (r.status === "fulfilled" ? r.value : null)));
        if (i + 5 < top.length) await new Promise(res => setTimeout(res, 300));
        if (cancelledRef.current) return;
      }

      if (cancelledRef.current) return;

      // Details 배치 조회 (location_id 없는 항목은 null)
      const detailResults: ({ rating: number; reviews: number } | null)[] = [];
      for (let i = 0; i < idResults.length; i += 5) {
        const batch = await Promise.allSettled(
          idResults.slice(i, i + 5).map(id =>
            id ? fetchTaDetail(id) : Promise.resolve(null)
          ),
        );
        detailResults.push(...batch.map(r => (r.status === "fulfilled" ? r.value : null)));
        if (i + 5 < idResults.length) await new Promise(res => setTimeout(res, 300));
        if (cancelledRef.current) return;
      }

      if (cancelledRef.current) return;

      // Place 조립
      const places: Place[] = top.map(({ item, category }, i) => {
        const detail = detailResults[i] ?? null;

        return {
          id:       parseInt(item.id, 10),
          name:     item.place_name,
          category,
          rating:   detail?.rating  ?? 0,
          reviews:  detail?.reviews ?? 0,
          district: item.address_name.split(" ").slice(0, 2).join(" "),
          lat:      parseFloat(item.y),
          lng:      parseFloat(item.x),
          distance: parseInt(item.distance, 10),
        };
      });

      sessionStorage.setItem(cacheKey, JSON.stringify(places));
      setPlaceList(places);
      setIsLoading(false);
    };

    return () => { cancelledRef.current = true; };
  }, [userLat, userLng, radiusMeter, enabled, fetchKey]);

  const refetch = useCallback(() => {
    const cacheKey = `kakao_nearby_${userLat.toFixed(4)}_${userLng.toFixed(4)}_${radiusMeter}`;
    sessionStorage.removeItem(cacheKey);
    setFetchKey(prev => prev + 1);
  }, [userLat, userLng, radiusMeter]);

  return { placeList, isLoading, error, refetch };
};