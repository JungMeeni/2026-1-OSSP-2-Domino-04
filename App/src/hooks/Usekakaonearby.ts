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

const TA_API_KEY = import.meta.env.VITE_TRIPADVISOR_API_KEY as string;

const KAKAO_CATEGORY_LIST: { code: string; category: Category }[] = [
  { code: "AT4", category: "명소" },   // 관광명소
  { code: "CT1", category: "문화" },   // 문화시설
  { code: "CE7", category: "카페" },   // 카페
];

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

// Vite 프록시 경유 URL 생성
const taUrl = (path: string) =>
  import.meta.env.DEV
    ? `/vite-proxy/tripadvisor/api/v1/${path}`
    : `${import.meta.env.VITE_BACKEND_URL}/api/tripadvisor/${path}`;

/**
 * 장소명 + 좌표로 Tripadvisor location_id 조회
 * latLong 힌트를 함께 보내 정확도 향상
 */
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
      key:         TA_API_KEY,
    });
    const res  = await fetch(`${taUrl("location/search")}?${params}`);
    if (!res.ok) return null;
    const json: TaSearchResponse = await res.json();
    return json.data?.[0]?.location_id ?? null;
  } catch {
    return null;
  }
};

/**
 * location_id로 Tripadvisor Details에서 평점·리뷰 수 조회
 */
export const fetchTaDetail = async (
  locationId: string,
): Promise<{ rating: number; reviews: number } | null> => {
  try {
    const params = new URLSearchParams({ language: "ko", key: TA_API_KEY });
    const res    = await fetch(`${taUrl(`location/${locationId}/details`)}?${params}`);
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
      // 거리순 정렬 후 최대 30개 (API 호출 수 제한)
      items.sort((a, b) => parseInt(a.item.distance) - parseInt(b.item.distance));
      const top = items.slice(0, 30);

      // location_id 병렬 조회
      const idResults = await Promise.allSettled(
        top.map(({ item }) =>
          fetchTaLocationId(
            item.place_name,
            parseFloat(item.y),
            parseFloat(item.x),
          )
        ),
      );

      if (cancelledRef.current) return;

      // Details 병렬 조회 (location_id 없는 항목은 null)
      const detailResults = await Promise.allSettled(
        idResults.map(res =>
          res.status === "fulfilled" && res.value
            ? fetchTaDetail(res.value)
            : Promise.resolve(null)
        ),
      );

      if (cancelledRef.current) return;

      // Place 조립
      const places: Place[] = top.map(({ item, category }, i) => {
        const detail =
          detailResults[i].status === "fulfilled" ? detailResults[i].value : null;

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