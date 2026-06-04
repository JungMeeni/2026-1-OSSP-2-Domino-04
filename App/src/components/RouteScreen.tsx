// ═══════════════════════════════════════════════════════════
// RouteScreen — 앱 루트 화면: 풀스크린 지도 + FAB + 바텀 시트
//
// [구조]
//   풀스크린 카카오 지도 위에 아래 레이어가 쌓인다:
//     - 상단 검색창 (장소 키워드 검색 + 드롭다운 + 현위치 버튼)
//     - FAB (+버튼) → "주변 탐색" / "경로 탐색" 메뉴 펼침
//     - 하프/풀 바텀 시트 (드래그 리사이즈)
//
//   탭별 바텀 시트 내용:
//     nearby — 반경 선택 + PlaceCard 목록 (NearByMap 지도 오버레이 연동)
//     route  — RoutePanel (추천 경로 + 직접 입력 통합)
//
// [Google 로그인]
//   @react-oauth/google 사용. 프로필 이미지를 검색창 우측에 표시
//
// [내부 훅]
//   useUserLocation     — geolocation으로 현위치 취득
//   useKakaoNearby      — 반경 내 장소 목록 fetch
//   useRecommendedRoute — 추천 경로 fetch
//   usePlaceSearch      — 검색창 상태 관리
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback, type FC } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import type {
  Tab, Place, UserLocation,
  RoutePoint, RouteState, RouteResult, Category,
} from "../types/type";
import type {
  KakaoLatLng, KakaoLatLngBounds, KakaoMapInstance,
  KakaoCircle, KakaoGeocoder, KakaoMarker, KakaoOverlay, KakaoPolyline,
  KakaoPlaceSearchResult, KakaoPlaces,
} from "../types/type_kakao";
import {
  COLOR_BG, COLOR_BORDER, COLOR_INACTIVE,
  COLOR_PRIMARY, COLOR_SURFACE, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
} from "../colors";

import { useKakaoNearby }      from "../hooks/Usekakaonearby";
import { useRecommendedRoute } from "../hooks/Userecommendedroute";
import { useDisasterAlert }    from "../hooks/UseDisasterAlert";

import PlaceCard  from "./PlaceCard";
import DisasterAlertBanner from "./DisasterAlertBanner";
import DisasterStatusChip  from "./DisasterStatusChip";
import DisasterZoneOverlay from "./DisasterZoneOverlay";
import NearbyMap  from "./NearByMap";
import RoutePanel from "./RoutePanel";
import PlaceMarker from "./PlaceMarker";
import { kakaoResultToPlace } from "../utils/Utils";
import { usePlaceSearch } from "../hooks/UsePlaceSearch";
import { fetchTaLocationId, fetchTaDetail } from "../hooks/Usekakaonearby";

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;
const COLOR_USER_PIN      = "#3B7DFF";
const COLOR_USER_PIN_RING = "rgba(59,125,255,0.18)";

const RADIUS_OPTION_LIST = [
  { label: "가까운 곳", meter: 250  },
  { label: "기본",      meter: 500  },
  { label: "넓은 곳",   meter: 1000 },
] as const;

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍", 식당: "🍽️"
};

const IconNearby: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeOpacity="0.5" />
    <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

// [CHANGED] route 탭 아이콘 — 별 + 경로 조합
const IconRoute: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" />
    <path d="M6 17V9a6 6 0 0 1 6-6h2" /><path d="M18 7v8a6 6 0 0 1-6 6H10" />
  </svg>
);

const IconGoogle: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// [CHANGED] FAB 메뉴 2개로 단순화
const MENU_ITEM_LIST: { id: Tab; Icon: FC; label: string }[] = [
  { id: "nearby", Icon: IconNearby, label: "주변 탐색" },
  { id: "route",  Icon: IconRoute,  label: "경로 탐색" },
];

const TAB_HEADER: Record<string, { sub: string; main: string }> = {
  nearby: { sub: "NEARBY EXPLORE", main: "근처 인기 장소 탐색" },
  route:  { sub: "ROUTE PLANNING", main: "경로 탐색"           },
};

const SHEET_HEIGHT_HALF = 48;
const SHEET_HEIGHT_FULL = 88;
const DRAG_THRESHOLD    = 60;

type GoogleUserProfile = { name: string; email: string; picture: string };

declare global {
  interface Window {
    kakao: {
      maps: {
        load:          (cb: () => void) => void;
        Map:           new (el: HTMLElement, opts: object) => KakaoMapInstance;
        LatLng:        new (lat: number, lng: number) => KakaoLatLng;
        LatLngBounds:  new () => KakaoLatLngBounds;
        CustomOverlay: new (opts: object) => KakaoOverlay;
        Circle:        new (opts: object) => KakaoCircle;
        Marker:        new (opts: object) => KakaoMarker;
        MarkerImage:   new (src: string, size: object) => object;
        Polyline:      new (opts: object) => KakaoPolyline;
        Size:          new (w: number, h: number) => object;
        services: {
          Geocoder: new () => KakaoGeocoder;
          Places:   new () => KakaoPlaces;
          Status:   { OK: string };
          SortBy:   { DISTANCE: string };
        };
        event: { addListener: (target: object, type: string, handler: () => void) => void };
      };
    };
  }
}

// ═══════════════════════════════════════════════════════════
// useUserLocation
// ═══════════════════════════════════════════════════════════

const useUserLocation = (): UserLocation => {
  const [lat,        setLat]        = useState<number>(DEFAULT_LAT);
  const [lng,        setLng]        = useState<number>(DEFAULT_LNG);
  const [isLocating, setIsLocating] = useState<boolean>(true);
  const [locLabel,   setLocLabel]   = useState<string>("📍 위치 불러오는 중...");
  useEffect(() => {
    if (!navigator.geolocation) { setIsLocating(false); setLocLabel("📍 위치 미지원 (기본 위치 사용)"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setIsLocating(false); setLocLabel("📍 현위치 기준"); },
      ()  => { setIsLocating(false); setLocLabel("📍 위치 권한 거부됨 (기본 위치 사용)"); },
      { timeout: 8000, enableHighAccuracy: true },
    );
  }, []);
  return { lat, lng, isLocating, locLabel };
};

// ═══════════════════════════════════════════════════════════
// RouteScreen
// ═══════════════════════════════════════════════════════════

type SheetState = "hidden" | "half" | "full";

const RouteScreen: FC = () => {
  const [activeTab,     setActiveTab]     = useState<Tab | null>(null);
  // [NAV] 안내 중 상태
  const [isNavigating,  setIsNavigating]  = useState<boolean>(false);
  const [navRoute,      setNavRoute]      = useState<import("../hooks/Userecommendedroute").RecommendedRoute | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("hidden");
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(null);

  const [selectedRadiusIdx,    setSelectedRadiusIdx]    = useState<number>(1);
  const [selectedPlace,        setSelectedPlace]        = useState<Place | null>(null);
  const [confirmedSearchPlace, setConfirmedSearchPlace] = useState<Place | null>(null);
  const [searchRatings,        setSearchRatings]        = useState<Record<string, number>>({});

  const [routeState, setRouteState] = useState<RouteState>({
    origin: null, destination: null, result: null, isLoading: false, errorMsg: "",
  });

  const kakaoMapRef    = useRef<KakaoMapInstance | null>(null);
  const mapElRef       = useRef<HTMLDivElement>(null);
  const userOverlayRef = useRef<KakaoOverlay | null>(null);
  const [isMapReady,      setIsMapReady]      = useState<boolean>(false);
  const [isServicesReady, setIsServicesReady] = useState<boolean>(false);

  // 공유 지도 레이어 ref
  const polylineListRef = useRef<KakaoPolyline[]>([]);
  const overlayListRef  = useRef<KakaoOverlay[]>([]);

  const { lat: userLat, lng: userLng, isLocating, locLabel } = useUserLocation();
  const dragStartYRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const sheetElRef    = useRef<HTMLDivElement>(null);
  const radiusConfig  = RADIUS_OPTION_LIST[selectedRadiusIdx];

  // 주변 탐색
  const { placeList: kakaoPlaceList, isLoading: kakaoIsLoading, error: kakaoError, refetch: kakaoRefetch } =
    useKakaoNearby({ userLat, userLng, radiusMeter: radiusConfig.meter, enabled: activeTab === "nearby" && !isLocating && isServicesReady });

  // [CHANGED] 추천 경로 — route 탭이 열릴 때 활성화
  const { routes: recRoutes, isLoading: recIsLoading, error: recError, refetch: recRefetch } =
    useRecommendedRoute({ userLat, userLng, enabled: activeTab === "route" && !isLocating && isServicesReady });

  // [API] 재난 알림 큐 — useMock=true: Mock 데이터, false: 실제 API 연동
  const { currentAlert, alertQueue, remainingSec, dismissCurrent } = useDisasterAlert(false);

  // [CONFIG] 활성 재난 목록 — 배너 닫혀도 지도에 계속 표시
  const activeAlerts = alertQueue;

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async tokenRes => {
      try {
        const res  = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokenRes.access_token}` } });
        const data = await res.json();
        setGoogleUser({ name: data.name, email: data.email, picture: data.picture });
      } catch { console.error("Google 유저 정보 조회 실패"); }
    },
    onError: () => console.error("Google 로그인 실패"),
  });
  const handleGoogleLogout = useCallback(() => setGoogleUser(null), []);

  useEffect(() => {
    if (!window.kakao?.maps || !mapElRef.current) return;
    window.kakao.maps.load(() => {
      const map = new window.kakao.maps.Map(mapElRef.current!, {
        center: new window.kakao.maps.LatLng(DEFAULT_LAT, DEFAULT_LNG), level: 4,
      });
      kakaoMapRef.current = map;
      setIsMapReady(true);
      setIsServicesReady(true);
    });
  }, []);

  useEffect(() => {
    if (!isMapReady || isLocating || !kakaoMapRef.current) return;
    userOverlayRef.current?.setMap(null);
    const el = document.createElement("div");
    el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${COLOR_USER_PIN};border:3px solid #fff;box-shadow:0 0 0 5px ${COLOR_USER_PIN_RING};`;
    userOverlayRef.current = new window.kakao.maps.CustomOverlay({
      map: kakaoMapRef.current, position: new window.kakao.maps.LatLng(userLat, userLng),
      content: el, yAnchor: 0.5, zIndex: 20,
    });
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(userLat, userLng));
  }, [isMapReady, isLocating, userLat, userLng]);

  useEffect(() => {
    if (!selectedPlace || !kakaoMapRef.current || !isMapReady) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(selectedPlace.lat, selectedPlace.lng));
  }, [selectedPlace, isMapReady]);

  const clearMapLayers = useCallback(() => {
    polylineListRef.current.forEach(p => p.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = []; overlayListRef.current = [];
  }, []);

  const handleMoveToCurrentLoc = useCallback(() => {
    if (!kakaoMapRef.current || !isMapReady) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(userLat, userLng));
  }, [userLat, userLng, isMapReady]);

  const handleMenuSelect = useCallback((tab: Tab) => {
    if (tab !== activeTab) clearMapLayers();
    setActiveTab(tab);
    setIsMenuOpen(false);
    // [NAV] 안내 중이면 시트 열어서 상세 표시, 아니면 half
    setSheetState("half");
  }, [activeTab, clearMapLayers]);

  // [NAV] 안내 시작
  const handleStartNavigation = useCallback((route: import("../hooks/Userecommendedroute").RecommendedRoute) => {
    setNavRoute(route);
    setIsNavigating(true);
    setSheetState("hidden");
  }, []);

  // [NAV] 안내 취소
  const handleCancelNavigation = useCallback(() => {
    setIsNavigating(false);
    setNavRoute(null);
    clearMapLayers();
    setSheetState("half");
  }, [clearMapLayers]);

  const handleCloseSheet = useCallback(() => {
    setSheetState("hidden");
    setTimeout(() => setActiveTab(null), 300);
  }, []);

  const handleDragStart = useCallback((y: number) => { isDraggingRef.current = true; dragStartYRef.current = y; }, []);
  const handleDragEnd   = useCallback((y: number) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const delta = y - dragStartYRef.current;
    if (sheetState === "half") {
      if (delta < -DRAG_THRESHOLD) setSheetState("full");
      else if (delta > DRAG_THRESHOLD) handleCloseSheet();
    } else if (sheetState === "full" && delta > DRAG_THRESHOLD) setSheetState("half");
  }, [sheetState, handleCloseSheet]);

  const searchRatingsRef = useRef(searchRatings);
  useEffect(() => { searchRatingsRef.current = searchRatings; }, [searchRatings]);

  const onSearchConfirm = useCallback((result: KakaoPlaceSearchResult) => {
    const place = { ...kakaoResultToPlace(result), rating: searchRatingsRef.current[result.id] ?? 0 };
    setSelectedPlace(place);
    setConfirmedSearchPlace(place);
  }, []);

  const onSearchFocus = useCallback((result: KakaoPlaceSearchResult) => {
    if (kakaoMapRef.current && isMapReady) {
      kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(parseFloat(result.y), parseFloat(result.x)));
      kakaoMapRef.current.setLevel(3);
    }
  }, [isMapReady]);

  const {
    query:        searchQuery,
    setQuery:     setSearchQuery,
    results:      searchResults,
    showDropdown,  setShowDropdown,
    focusedResult: focusedSearchResult,
    handleSelect:  handleSelectSearchResult,
    handleClear:   handleClearSearch,
  } = usePlaceSearch({ isServicesReady, onConfirm: onSearchConfirm, onFocusResult: onSearchFocus });

  // 검색 결과가 바뀔 때마다 각 장소의 평점을 비동기로 fetch
  // - localStorage("ta_${id}") 캐시 공유 (추천 경로·직접 입력과 동일 키)
  // - 5개씩 순차 처리 → TripAdvisor rate limit(5 req/s) 방지
  useEffect(() => {
    if (searchResults.length === 0) { setSearchRatings({}); return; }

    const TA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const readCache = (id: string): number | undefined => {
      try {
        const raw = localStorage.getItem(`ta_${id}`);
        if (!raw) return undefined;
        const { data, ts } = JSON.parse(raw) as { data: { rating: number } | null; ts: number };
        if (!data || Date.now() - ts > TA_CACHE_TTL) { localStorage.removeItem(`ta_${id}`); return undefined; }
        return data.rating > 0 ? data.rating : undefined;
      } catch { return undefined; }
    };
    const writeCache = (id: string, rating: number) => {
      try {
        const raw = localStorage.getItem(`ta_${id}`);
        const prev = raw ? JSON.parse(raw) : null;
        // 기존 캐시에 rating만 갱신하고 나머지 필드(reviews, webUrl 등) 유지
        const data = { ...(prev?.data ?? {}), rating };
        localStorage.setItem(`ta_${id}`, JSON.stringify({ data, ts: Date.now() }));
      } catch { }
    };

    let cancelled = false;
    const targets = searchResults.slice(0, 10);

    // 먼저 캐시에서 읽어 즉시 반영
    const fromCache: Record<string, number> = {};
    targets.forEach(r => {
      const cached = readCache(r.id);
      if (cached !== undefined) fromCache[r.id] = cached;
    });
    if (Object.keys(fromCache).length > 0) setSearchRatings(fromCache);

    // 캐시 미스 항목만 5개씩 순차 API 호출
    const needFetch = targets.filter(r => readCache(r.id) === undefined);
    if (needFetch.length === 0) return () => { cancelled = true; };

    (async () => {
      for (let i = 0; i < needFetch.length; i += 5) {
        if (cancelled) return;
        const batch = needFetch.slice(i, i + 5);
        await Promise.all(batch.map(async result => {
          const locationId = await fetchTaLocationId(result.place_name, parseFloat(result.y), parseFloat(result.x));
          if (cancelled || !locationId) return;
          const detail = await fetchTaDetail(locationId);
          if (cancelled || !detail || detail.rating <= 0) return;
          writeCache(result.id, detail.rating);
          setSearchRatings(prev => ({ ...prev, [result.id]: detail.rating }));
        }));
        if (i + 5 < needFetch.length) await new Promise(res => setTimeout(res, 300));
      }
    })();

    return () => { cancelled = true; };
  }, [searchResults]);

  const handleSelectPlace  = (place: Place | null) => setSelectedPlace(prev => prev?.id === place?.id ? null : place);
  const handleSelectRadius = (idx: number) => { setSelectedRadiusIdx(idx); setSelectedPlace(null); };
  const handleSetOrigin    = (p: RoutePoint | null) => setRouteState(prev => ({ ...prev, origin: p }));
  const handleSetDest      = (p: RoutePoint | null) => setRouteState(prev => ({ ...prev, destination: p }));
  const handleSetResult    = (r: RouteResult | null) => setRouteState(prev => ({ ...prev, result: r }));
  const handleSetLoading   = (v: boolean) => setRouteState(prev => ({ ...prev, isLoading: v }));
  const handleSetError     = (m: string)  => setRouteState(prev => ({ ...prev, errorMsg: m }));

  const sheetHeightVh = sheetState === "full" ? SHEET_HEIGHT_FULL : sheetState === "half" ? SHEET_HEIGHT_HALF : 0;

  return (
    <div style={{ position: "fixed", inset: 0, fontFamily: "'Noto Sans KR', sans-serif", background: "#000" }}>
      <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

      {/* [NAV] 안내 중 상단 뱃지 */}
      {isNavigating && navRoute && (
        <div style={{
          position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 920, background: COLOR_PRIMARY, color: "#fff",
          borderRadius: 24, padding: "8px 18px",
          display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          fontFamily: "'Noto Sans KR', sans-serif",
          cursor: "pointer",
        }}
          onClick={() => setSheetState(prev => prev === "hidden" ? "half" : "hidden")}
        >
          <span style={{ fontSize: 13 }}>🗺</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{navRoute.label} 안내 중</span>
          <span style={{ fontSize: 11, opacity: 0.85 }}>탭하여 상세보기</span>
        </div>
      )}

      {/* [API] 재난 위험구역 지도 오버레이 */}
      <DisasterZoneOverlay
        activeAlerts={activeAlerts}
        kakaoMapRef={kakaoMapRef}
        isMapReady={isMapReady}
      />

      {/* [API] 재난 현황 플로팅 배지 */}
      <DisasterStatusChip
        activeAlerts={activeAlerts}
        alertQueue={alertQueue}
      />

      {/* [API] 재난 알림 배너 */}
      <DisasterAlertBanner
        currentAlert={currentAlert}
        alertQueue={alertQueue}
        remainingSec={remainingSec}
        onDismiss={dismissCurrent}
        kakaoMapRef={kakaoMapRef}
        isNavigating={isNavigating}
        onSelectRoute={(isDetour) => {
          // [TODO] 실제 경로 변경 로직 연결 (우회 경로 재탐색)
          console.log(isDetour ? "우회 경로 적용" : "현재 경로 유지");
        }}
      />

      {/* 검색창 + 드롭다운 래퍼 */}
      <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 30 }}>
        <div style={{ background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", borderRadius: 14, boxShadow: "0 2px 16px rgba(0,0,0,0.12)", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLOR_TEXT_SUB} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="22" y2="22" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setConfirmedSearchPlace(null); }}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="장소, 주소를 검색하세요"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: COLOR_TEXT_MAIN, background: "transparent", fontFamily: "'Noto Sans KR', sans-serif" }}
          />
          {searchQuery.length > 0 && (
            <div onClick={() => { handleClearSearch(); setConfirmedSearchPlace(null); }} style={{ width: 20, height: 20, borderRadius: "50%", background: COLOR_INACTIVE, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#fff", fontWeight: 700 }}>✕</div>
          )}
          <div style={{ width: 1, height: 18, background: COLOR_BORDER, flexShrink: 0 }} />
          <div onClick={() => googleUser ? handleGoogleLogout() : handleGoogleLogin()} style={{ width: 32, height: 32, borderRadius: "50%", background: googleUser ? COLOR_BG : "#fff", border: `1px solid ${COLOR_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, overflow: "hidden" }}>
            {googleUser ? <img src={googleUser.picture} alt={googleUser.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : <IconGoogle />}
          </div>
          <div onClick={handleMoveToCurrentLoc} style={{ width: 32, height: 32, borderRadius: "50%", background: isLocating ? COLOR_BG : `${COLOR_USER_PIN}18`, border: `1px solid ${isLocating ? COLOR_BORDER : COLOR_USER_PIN}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: isLocating ? "default" : "pointer", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isLocating ? COLOR_TEXT_SUB : COLOR_USER_PIN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" strokeOpacity="0.25" />
            </svg>
          </div>
        </div>

        {/* 장소 키워드 검색 결과 드롭다운 */}
        {showDropdown && searchResults.length > 0 && (
          <div style={{ marginTop: 6, background: "rgba(255,255,255,0.98)", backdropFilter: "blur(10px)", borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.14)", overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
            {searchResults.map((result, i) => {
              const isFocused = focusedSearchResult?.id === result.id;
              return (
                <div
                  key={result.id}
                  onMouseDown={e => { e.preventDefault(); handleSelectSearchResult(result); }}
                  style={{
                    padding: "10px 14px",
                    borderBottom: i < searchResults.length - 1 ? `1px solid ${COLOR_BORDER}` : "none",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    background: isFocused ? `${COLOR_PRIMARY}0d` : "transparent",
                    boxShadow: isFocused ? `inset 0 0 0 2px ${COLOR_PRIMARY}` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isFocused ? COLOR_PRIMARY : COLOR_TEXT_MAIN }}>{result.place_name}</span>
                    {!!searchRatings[result.id] && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#f59a00", background: "#fff8ed", borderRadius: 6, padding: "1px 6px", border: "1px solid #f7d48a" }}>⭐ {searchRatings[result.id].toFixed(1)}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{result.road_address_name || result.address_name}</div>
                  {result.category_name && (
                    <div style={{ fontSize: 11, color: COLOR_PRIMARY }}>{result.category_name.split(" > ").pop()}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 장소 키워드 검색 결과 지도 오버레이 */}
      {searchResults.length > 0
        ? searchResults.map((result) => {
            const place = { ...kakaoResultToPlace(result), rating: searchRatings[result.id] ?? 0 };
            return (
              <PlaceMarker
                key={result.id}
                place={place}
                isSelected={focusedSearchResult?.id === result.id}
                isActive={true}
                isDeemphasized={focusedSearchResult?.id !== result.id}
                kakaoMapRef={kakaoMapRef}
                onSelectPlace={handleSelectPlace}
              />
            );
          })
        : confirmedSearchPlace && (
            <PlaceMarker
              key={confirmedSearchPlace.id}
              place={confirmedSearchPlace}
              isSelected={true}
              isActive={true}
              isDeemphasized={false}
              kakaoMapRef={kakaoMapRef}
              onSelectPlace={() => setConfirmedSearchPlace(null)}
            />
          )
      }

      {/* 지도 오버레이 */}
      {activeTab === "nearby" && (
        <NearbyMap
          userLat={userLat} userLng={userLng} isLocating={isLocating} locLabel={locLabel}
          radiusMeter={radiusConfig.meter} selectedPlace={selectedPlace} onSelectPlace={handleSelectPlace}
          selectedRadiusIdx={selectedRadiusIdx} onSelectRadius={handleSelectRadius}
          kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} placeList={kakaoPlaceList}
        />
      )}

      {sheetState !== "hidden" && (
        <div onClick={handleCloseSheet} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.08)", pointerEvents: "auto" }} />
      )}

      {/* FAB */}
      <div style={{ position: "absolute", bottom: 32, right: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, zIndex: 50 }}>
        {MENU_ITEM_LIST.map((item, i) => (
          <div key={item.id} onClick={() => handleMenuSelect(item.id)} style={{ display: "flex", alignItems: "center", gap: 10, opacity: isMenuOpen ? 1 : 0, transform: isMenuOpen ? "translateY(0) scale(1)" : "translateY(16px) scale(0.85)", transition: `opacity 0.22s ease ${i * 0.06}s, transform 0.22s ease ${i * 0.06}s`, pointerEvents: isMenuOpen ? "auto" : "none", cursor: "pointer" }}>
            <div style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, boxShadow: "0 2px 12px rgba(0,0,0,0.12)", whiteSpace: "nowrap" }}>{item.label}</div>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: COLOR_PRIMARY, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 14px rgba(0,0,0,0.18)", flexShrink: 0 }}><item.Icon /></div>
          </div>
        ))}
        <div onClick={() => setIsMenuOpen(prev => !prev)} style={{ width: 56, height: 56, borderRadius: "50%", background: COLOR_PRIMARY, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(245,154,0,0.45)", cursor: "pointer", transition: "transform 0.25s ease", transform: isMenuOpen ? "rotate(45deg)" : "rotate(0deg)", zIndex: 51 }}>
          <span style={{ fontSize: 26, color: "#fff", lineHeight: 1, fontWeight: 300 }}>+</span>
        </div>
      </div>

      {/* 바텀 시트 */}
      <div ref={sheetElRef} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${sheetHeightVh}vh`, background: COLOR_SURFACE, borderRadius: "20px 20px 0 0", boxShadow: "0 -4px 32px rgba(0,0,0,0.14)", transition: isDraggingRef.current ? "none" : "height 0.32s cubic-bezier(0.32,0.72,0,1)", zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div onTouchStart={e => handleDragStart(e.touches[0].clientY)} onTouchEnd={e => handleDragEnd(e.changedTouches[0].clientY)} onMouseDown={e => handleDragStart(e.clientY)} onMouseUp={e => handleDragEnd(e.clientY)} style={{ padding: "12px 0 8px", flexShrink: 0, cursor: "grab", userSelect: "none" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: COLOR_BORDER, margin: "0 auto" }} />
        </div>

        {activeTab && (
          <div style={{ padding: "4px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, borderBottom: `1px solid ${COLOR_BORDER}` }}>
            <div>
              <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, letterSpacing: 2, fontWeight: 600 }}>{TAB_HEADER[activeTab]?.sub}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: COLOR_TEXT_MAIN, marginTop: 2 }}>{TAB_HEADER[activeTab]?.main}</div>
            </div>
            <div onClick={handleCloseSheet} style={{ width: 32, height: 32, borderRadius: "50%", background: COLOR_BG, border: `1px solid ${COLOR_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, color: COLOR_TEXT_SUB }}>✕</div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>

          {/* 주변 탐색 */}
          {activeTab === "nearby" && (
            <div style={{ padding: "12px 16px 24px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {RADIUS_OPTION_LIST.map((opt, i) => (
                  <button key={opt.label} onClick={() => handleSelectRadius(i)} style={{ flex: 1, padding: "7px 0", borderRadius: 10, border: `1.5px solid ${selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_BORDER}`, background: selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_SURFACE, color: selectedRadiusIdx === i ? "#fff" : COLOR_TEXT_SUB, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s" }}>
                    {opt.label}
                    <div style={{ fontSize: 10, fontWeight: 400, marginTop: 1, opacity: 0.8 }}>{opt.meter >= 1000 ? `${opt.meter / 1000}km` : `${opt.meter}m`}</div>
                  </button>
                ))}
              </div>
              {kakaoIsLoading && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "32px 0", color: COLOR_TEXT_SUB }}>
                  <div style={{ width: 28, height: 28, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 13 }}>주변 장소를 불러오는 중...</span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}
              {!kakaoIsLoading && kakaoError && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "32px 0" }}>
                  <span style={{ fontSize: 28 }}>⚠️</span>
                  <span style={{ fontSize: 13, color: "#e53e3e", textAlign: "center" }}>{kakaoError}</span>
                  <button onClick={kakaoRefetch} style={{ padding: "8px 18px", borderRadius: 10, border: `1.5px solid ${COLOR_PRIMARY}`, background: "transparent", color: COLOR_PRIMARY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>다시 시도</button>
                </div>
              )}
              {!kakaoIsLoading && !kakaoError && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>주변 장소 <span style={{ color: COLOR_PRIMARY }}>{kakaoPlaceList.length}</span></span>
                    <span style={{ fontWeight: 400, fontSize: 11 }}>거리순</span>
                    <button onClick={kakaoRefetch} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLOR_TEXT_SUB, padding: 0 }}>🔄</button>
                  </div>
                  {kakaoPlaceList.length === 0
                    ? <div style={{ textAlign: "center", color: COLOR_INACTIVE, fontSize: 13, padding: 32 }}>반경 내 장소가 없어요</div>
                    : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {kakaoPlaceList.map(place => (
                          <PlaceCard key={place.id} place={place} isSelected={selectedPlace?.id === place.id} onSelect={handleSelectPlace} />
                        ))}
                      </div>
                  }
                </>
              )}
            </div>
          )}

          {/* [CHANGED] 경로 탐색 탭 — 추천 경로 + 직접 입력 통합 */}
          {activeTab === "route" && (
            <RoutePanel
              routeState={routeState}
              onSetOrigin={handleSetOrigin} onSetDest={handleSetDest}
              onSetResult={handleSetResult} onSetLoading={handleSetLoading} onSetError={handleSetError}
              userLat={userLat} userLng={userLng}
              kakaoMapRef={kakaoMapRef}
              polylineListRef={polylineListRef}
              overlayListRef={overlayListRef}
              recRoutes={recRoutes}
              recIsLoading={recIsLoading}
              recError={recError}
              recRefetch={recRefetch}
              isNavigating={isNavigating}
              onStartNavigation={handleStartNavigation}
              onCancelNavigation={handleCancelNavigation}
              isServicesReady={isServicesReady}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RouteScreen;