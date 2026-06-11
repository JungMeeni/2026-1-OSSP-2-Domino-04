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
import type { DisasterZoneInfo } from "./Userecommendedroute";

// ── [CONFIG] ──────────────────────────────────────────────


// ── [BLACKLIST] 주변 탐색 제외 장소 ─────────────────────
// routemodel.py 블랙리스트와 동일 기준

const _EXACT_BL = new Set([
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
]);

const _SUBSTR_BL = [
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
];

const isNearbyBlacklisted = (name: string): boolean => {
  for (const kw of _EXACT_BL) if (name.includes(kw)) return true;
  return _SUBSTR_BL.some(kw => name.includes(kw));
};

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
  road_address_name?:  string;
  x:                   string;   // 경도
  y:                   string;   // 위도
  distance:            string;   // 미터
}

interface TaSearchResponse {
  data?:  { location_id: string; name: string; distance?: string }[];
  error?: { message: string };
}

interface TaDetailResponse {
  rating?:      string;
  num_reviews?: string;
  error?:       { message: string };
}

export interface TaFullDetail {
  name?:         string;
  description?:  string;
  web_url?:      string;
  address_obj?:  { address_string?: string; street1?: string; city?: string };
  phone?:        string;
  website?:      string;
  rating?:       string;
  num_reviews?:  string;
  ranking_data?: { ranking_string?: string };
  price_level?:  string;
  hours?:        { weekday_text?: string[] };
  category?:     { localized_name?: string };
  subcategory?:  { localized_name?: string }[];
  latitude?:     string;
  longitude?:    string;
}

// ── [UTIL] ────────────────────────────────────────────────

export const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180, dλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// TripAdvisor API — idfriend.kr 서버 프록시 경유
// Express 서버가 idfriend.kr에 배포되어 서버 IP로 TripAdvisor를 호출하므로
// WAF 차단 없이 정상 동작한다. API 키는 서버에서 처리.
const _TA_BASE = (import.meta.env.VITE_BACKEND_URL ?? "") + "/api/tripadvisor";

export const fetchTaLocationId = async (
  placeName: string,
  lat:       number,
  lng:       number,
  language = "ko",
): Promise<string | null> => {
  try {
    const params = new URLSearchParams({
      searchQuery: placeName,
      latLong:     `${lat},${lng}`,
      language,
    });
    const res  = await fetch(`${_TA_BASE}/search?${params}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: TaSearchResponse = await res.json();
    const results = json.data ?? [];
    if (results.length === 0) return null;

    // 이름 정규화: 공백·특수문자 제거 후 소문자 비교
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.·]/g, "");
    const kakaoNorm = norm(placeName);

    // 1순위: 이름이 포함 관계인 결과
    for (const r of results) {
      const taNorm = norm(r.name);
      if (taNorm.includes(kakaoNorm) || kakaoNorm.includes(taNorm)) {
        return r.location_id;
      }
    }

    // 2순위: distance가 있으면 가장 가까운 것 (단위 불명확하므로 NaN 체크만)
    for (const r of results) {
      if (r.distance !== undefined && !isNaN(parseFloat(r.distance))) {
        return r.location_id;
      }
    }

    // 3순위: 첫 번째 결과
    return results[0].location_id;
  } catch {
    return null;
  }
};

export const fetchTaDetail = async (
  locationId: string,
  language = "ko",
): Promise<{ rating: number; reviews: number } | null> => {
  try {
    const res = await fetch(`${_TA_BASE}/details/${locationId}?language=${language}`, {
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

export const fetchTaFullDetail = async (
  locationId: string,
  language = "ko",
): Promise<TaFullDetail | null> => {
  const cacheKey = `ta_full_${locationId}_${language}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) return data as TaFullDetail;
    } catch {}
    localStorage.removeItem(cacheKey);
  }
  try {
    const res = await fetch(`${_TA_BASE}/details/${locationId}?language=${language}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json() as TaFullDetail;
    localStorage.setItem(cacheKey, JSON.stringify({ data: json, ts: Date.now() }));
    return json;
  } catch {
    return null;
  }
};

// ── [HOOK] ────────────────────────────────────────────────

interface UseKakaoNearbyOptions {
  userLat:       number;
  userLng:       number;
  radiusMeter:   number;
  enabled:       boolean;
  disasterZones?: DisasterZoneInfo[];
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
  disasterZones,
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

    const cacheKey = `kakao_nearby_${userLat.toFixed(4)}_${userLng.toFixed(4)}_${radiusMeter}`;
    // 재난 구역이 있을 때는 캐시 사용 안 함 — 제외 장소가 달라지므로
    if (!disasterZones?.length) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          setPlaceList(JSON.parse(cached));
          return;
        } catch {
          sessionStorage.removeItem(cacheKey);
        }
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
                if (!seenIds.has(item.id) && dist <= radiusMeter && !isNearbyBlacklisted(item.place_name)) {
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
      // 재난 구역이 있을 때는 perCat을 3배로 늘려 예비 후보 확보
      // → 구역 내 장소가 제거돼도 구역 밖 장소로 maxCount를 채울 수 있도록
      const perCat = Math.ceil(maxCount * (disasterZones?.length ? 3 : 1) / KAKAO_CATEGORY_LIST.length);
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

      // 재난 구역 내 장소 제외 → 남은 장소에서 maxCount개 선택
      const safeBalanced = disasterZones?.length
        ? balanced.filter(({ item }) => {
            const lat = parseFloat(item.y), lng = parseFloat(item.x);
            return !disasterZones.some(z => haversineM(lat, lng, z.lat, z.lng) <= z.radius_m);
          })
        : balanced;
      const top = safeBalanced.slice(0, maxCount);

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
          address:  item.road_address_name || item.address_name,
          lat:      parseFloat(item.y),
          lng:      parseFloat(item.x),
          distance: parseInt(item.distance, 10),
        };
      });

      // 재난 구역이 있을 때는 캐시 저장 안 함 — 구역 해제 후 원본 목록 복원을 위해
      if (!disasterZones?.length) sessionStorage.setItem(cacheKey, JSON.stringify(places));
      setPlaceList(places);
      setIsLoading(false);
    };

    return () => { cancelledRef.current = true; };
  // disasterZones 객체 참조 대신 JSON 문자열 비교로 불필요한 재실행 방지
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLat, userLng, radiusMeter, enabled, fetchKey, JSON.stringify(disasterZones ?? [])]);

  const refetch = useCallback(() => {
    const cacheKey = `kakao_nearby_${userLat.toFixed(4)}_${userLng.toFixed(4)}_${radiusMeter}`;
    sessionStorage.removeItem(cacheKey);
    setFetchKey(prev => prev + 1);
  }, [userLat, userLng, radiusMeter]);

  return { placeList, isLoading, error, refetch };
};