// ═══════════════════════════════════════════════════════════
// RouteScreen — 지도 풀스크린 + FAB + 하프 바텀 시트
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback, type FC } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import type {
  Tab, PlaceData, Place, UserLocation,
  RoutePoint, RouteState, RouteResult, Category,
} from "../types/type";
import type {
  KakaoLatLng, KakaoLatLngBounds, KakaoMapInstance,
  KakaoCircle, KakaoGeocoder, KakaoMarker, KakaoOverlay, KakaoPolyline,
} from "../types/type_kakao";
import {
  COLOR_BG, COLOR_BORDER, COLOR_INACTIVE,
  COLOR_PRIMARY, COLOR_SURFACE, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
} from "../colors";
import { toPlace } from "../utils/Utils";

import PlaceCard  from "./PlaceCard";
import RouteMap   from "./RouteMap";
import RoutePanel from "./RoutePanel";
import NearbyMap  from "./NearByMap";

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;

// [THEME] 현위치 마커 파란색
const COLOR_USER_PIN      = "#3B7DFF";
const COLOR_USER_PIN_RING = "rgba(59,125,255,0.18)";

const RADIUS_OPTION_LIST = [
  { label: "가까운 곳", meter: 250  },
  { label: "기본",      meter: 500  },
  { label: "넓은 곳",   meter: 1000 },
] as const;

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍",
};

// [CONFIG] FAB 아이콘 — 오렌지 단색 SVG
const IconNearby: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="8" strokeOpacity="0.5" />
    <line x1="12" y1="2"  x2="12" y2="5"  />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2"  y1="12" x2="5"  y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

const IconRoute: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6"  cy="19" r="2" />
    <circle cx="18" cy="5"  r="2" />
    <path d="M6 17V9a6 6 0 0 1 6-6h2" />
    <path d="M18 7v8a6 6 0 0 1-6 6H10" />
  </svg>
);

// [CONFIG] Google 로고 SVG
const IconGoogle: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// [CONFIG] FAB 메뉴 항목
const MENU_ITEM_LIST: { id: Tab; Icon: FC; label: string }[] = [
  { id: "nearby", Icon: IconNearby, label: "주변 탐색" },
  { id: "route",  Icon: IconRoute,  label: "경로 탐색" },
];

// [CONFIG] 바텀 시트 높이 (vh 단위)
const SHEET_HEIGHT_HALF = 48;
const SHEET_HEIGHT_FULL = 88;

// [CONFIG] 드래그 임계값 (px)
const DRAG_THRESHOLD = 60;

// [TYPE] Google 유저 프로필
type GoogleUserProfile = {
  name:    string;
  email:   string;
  picture: string;
};

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
          Status: { OK: string };
        };
        event: {
          addListener: (target: object, type: string, handler: () => void) => void;
        };
      };
    };
  }
}

// ═══════════════════════════════════════════════════════════
// MOCK DATA
// [API] 실제 구현 시 Tripadvisor API 호출로 교체
// ═══════════════════════════════════════════════════════════

const PLACE_LIST: PlaceData[] = [
  { id:  1, name: "성수연방",          category: "카페",   rating: 4.7, reviews: 2341, district: "성동구", latOffset:  0.002, lngOffset: -0.003 },
  { id:  2, name: "대림창고",          category: "갤러리", rating: 4.5, reviews: 1823, district: "성동구", latOffset: -0.001, lngOffset:  0.002 },
  { id:  3, name: "서울숲",            category: "공원",   rating: 4.8, reviews: 5102, district: "성동구", latOffset:  0.004, lngOffset:  0.001 },
  { id:  4, name: "카페 어니언",       category: "카페",   rating: 4.6, reviews: 3214, district: "성동구", latOffset: -0.002, lngOffset:  0.003 },
  { id:  5, name: "하이브 사옥",       category: "명소",   rating: 4.9, reviews: 8821, district: "용산구", latOffset:  0.006, lngOffset: -0.004 },
  { id:  6, name: "경리단길",          category: "거리",   rating: 4.3, reviews: 2109, district: "용산구", latOffset: -0.005, lngOffset:  0.005 },
  { id:  7, name: "SM 엔터테인먼트",   category: "명소",   rating: 4.7, reviews: 6432, district: "강남구", latOffset:  0.008, lngOffset:  0.006 },
  { id:  8, name: "별마당도서관",      category: "문화",   rating: 4.6, reviews: 4521, district: "강남구", latOffset: -0.007, lngOffset: -0.002 },
  { id:  9, name: "광화문 광장",       category: "명소",   rating: 4.7, reviews: 6230, district: "종로구", latOffset:  0.003, lngOffset: -0.006 },
  { id: 10, name: "홍대 걷고싶은거리", category: "거리",   rating: 4.5, reviews: 8320, district: "마포구", latOffset: -0.004, lngOffset:  0.007 },
  { id: 11, name: "연남동 카페거리",   category: "카페",   rating: 4.5, reviews: 3412, district: "마포구", latOffset:  0.001, lngOffset: -0.005 },
  { id: 12, name: "남산타워",          category: "명소",   rating: 4.6, reviews: 9103, district: "용산구", latOffset:  0.005, lngOffset:  0.004 },
];

// ═══════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════

const useUserLocation = (): UserLocation => {
  const [lat,        setLat]        = useState<number>(DEFAULT_LAT);
  const [lng,        setLng]        = useState<number>(DEFAULT_LNG);
  const [isLocating, setIsLocating] = useState<boolean>(true);
  const [locLabel,   setLocLabel]   = useState<string>("📍 위치 불러오는 중...");

  useEffect(() => {
    if (!navigator.geolocation) {
      setIsLocating(false);
      setLocLabel("📍 위치 미지원 (기본 위치 사용)");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setIsLocating(false);
        setLocLabel("📍 현위치 기준");
      },
      () => {
        setIsLocating(false);
        setLocLabel("📍 위치 권한 거부됨 (기본 위치 사용)");
      },
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
  // ── 탭 / 시트 상태
  const [activeTab,  setActiveTab]  = useState<Tab | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("hidden");
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);

  // ── 검색창 상태
  const [searchQuery, setSearchQuery] = useState<string>("");

  // ── Google 로그인 상태
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(null);

  // ── 주변 탐색 상태
  const [selectedRadiusIdx, setSelectedRadiusIdx] = useState<number>(1);
  const [selectedPlace,     setSelectedPlace]     = useState<Place | null>(null);

  // ── 경로 탐색 상태
  const [routeState, setRouteState] = useState<RouteState>({
    origin: null, destination: null, result: null, isLoading: false, errorMsg: "",
  });

  // ── 지도 / 위치
  const kakaoMapRef    = useRef<KakaoMapInstance | null>(null);
  const mapElRef       = useRef<HTMLDivElement>(null);
  const userOverlayRef = useRef<KakaoOverlay | null>(null);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  const { lat: userLat, lng: userLng, isLocating, locLabel } = useUserLocation();

  // ── 바텀 시트 드래그
  const dragStartYRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const sheetElRef    = useRef<HTMLDivElement>(null);

  // [API] Google 로그인 — access token으로 userinfo 엔드포인트 호출
  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async tokenRes => {
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenRes.access_token}` },
        });
        const data = await res.json();
        setGoogleUser({ name: data.name, email: data.email, picture: data.picture });
      } catch {
        console.error("Google 유저 정보 조회 실패");
      }
    },
    onError: () => console.error("Google 로그인 실패"),
  });

  // [HANDLER] Google 로그아웃
  const handleGoogleLogout = useCallback(() => {
    setGoogleUser(null);
  }, []);

  // [INIT] 카카오맵 인스턴스 생성 — 마운트 1회
  useEffect(() => {
    if (!window.kakao?.maps || !mapElRef.current) return;
    window.kakao.maps.load(() => {
      const map = new window.kakao.maps.Map(mapElRef.current!, {
        center: new window.kakao.maps.LatLng(DEFAULT_LAT, DEFAULT_LNG),
        level:  4,
      });
      kakaoMapRef.current = map;
      setIsMapReady(true);
    });
  }, []);

  // [SYNC] 현위치 마커 — 탭 무관하게 항상 표시
  useEffect(() => {
    if (!isMapReady || isLocating || !kakaoMapRef.current) return;
    userOverlayRef.current?.setMap(null);
    const el = document.createElement("div");
    el.style.cssText = `
      width:14px; height:14px; border-radius:50%;
      background:${COLOR_USER_PIN};
      border:3px solid #fff;
      box-shadow:0 0 0 5px ${COLOR_USER_PIN_RING};
    `;
    userOverlayRef.current = new window.kakao.maps.CustomOverlay({
      map: kakaoMapRef.current, position: new window.kakao.maps.LatLng(userLat, userLng),
      content: el, yAnchor: 0.5, zIndex: 20,
    });
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(userLat, userLng));
  }, [isMapReady, isLocating, userLat, userLng]);

  // [SYNC] 장소 선택 시 지도 중심 이동
  useEffect(() => {
    if (!selectedPlace || !kakaoMapRef.current || !isMapReady) return;
    kakaoMapRef.current.setCenter(
      new window.kakao.maps.LatLng(selectedPlace.lat, selectedPlace.lng)
    );
  }, [selectedPlace, isMapReady]);

  // [HANDLER] 현위치로 지도 이동
  const handleMoveToCurrentLoc = useCallback(() => {
    if (!kakaoMapRef.current || !isMapReady) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(userLat, userLng));
  }, [userLat, userLng, isMapReady]);

  // [HANDLER] FAB 메뉴 항목 선택
  const handleMenuSelect = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setIsMenuOpen(false);
    setSheetState("half");
  }, []);

  // [HANDLER] 시트 닫기
  const handleCloseSheet = useCallback(() => {
    setSheetState("hidden");
    setTimeout(() => setActiveTab(null), 300);
  }, []);

  // [HANDLER] 드래그 시작
  const handleDragStart = useCallback((clientY: number) => {
    isDraggingRef.current = true;
    dragStartYRef.current = clientY;
  }, []);

  // [HANDLER] 드래그 종료
  const handleDragEnd = useCallback((clientY: number) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const delta = clientY - dragStartYRef.current;

    if (sheetState === "half") {
      if (delta < -DRAG_THRESHOLD) setSheetState("full");
      else if (delta > DRAG_THRESHOLD) handleCloseSheet();
    } else if (sheetState === "full") {
      if (delta > DRAG_THRESHOLD) setSheetState("half");
    }
  }, [sheetState, handleCloseSheet]);

  // 주변 탐색 데이터
  const radiusConfig    = RADIUS_OPTION_LIST[selectedRadiusIdx];
  const activePlaceList = PLACE_LIST
    .map(p => toPlace(p, userLat, userLng))
    .filter(p => p.distance <= radiusConfig.meter)
    .sort((a, b) => a.distance - b.distance);

  // 핸들러 모음
  const handleSelectPlace    = (place: Place | null) =>
    setSelectedPlace(prev => prev?.id === place?.id ? null : place);
  const handleSelectRadius   = (idx: number) => { setSelectedRadiusIdx(idx); setSelectedPlace(null); };
  const handleSetOrigin      = (point: RoutePoint | null) => setRouteState(prev => ({ ...prev, origin: point }));
  const handleSetDest        = (point: RoutePoint | null) => setRouteState(prev => ({ ...prev, destination: point }));
  const handleSetRouteResult = (result: RouteResult | null) => setRouteState(prev => ({ ...prev, result }));
  const handleSetLoading     = (isLoading: boolean) => setRouteState(prev => ({ ...prev, isLoading }));
  const handleSetError       = (errorMsg: string) => setRouteState(prev => ({ ...prev, errorMsg }));

  const sheetHeightVh =
    sheetState === "full" ? SHEET_HEIGHT_FULL :
    sheetState === "half" ? SHEET_HEIGHT_HALF : 0;

  return (
    <div style={{ position: "fixed", inset: 0, fontFamily: "'Noto Sans KR', sans-serif", background: "#000" }}>

      {/* ── 지도 (풀스크린 고정) */}
      <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── 검색창 */}
      <div style={{
        position: "absolute", top: 16, left: 16, right: 16, zIndex: 30,
        background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)",
        borderRadius: 14, boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
      }}>
        {/* 돋보기 */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLOR_TEXT_SUB} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="22" y2="22" />
        </svg>

        {/* 입력창 */}
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="장소, 주소를 검색하세요"
          style={{
            flex: 1, border: "none", outline: "none",
            fontSize: 14, color: COLOR_TEXT_MAIN,
            background: "transparent", fontFamily: "'Noto Sans KR', sans-serif",
          }}
        />

        {/* 입력 초기화 */}
        {searchQuery.length > 0 && (
          <div
            onClick={() => setSearchQuery("")}
            style={{
              width: 20, height: 20, borderRadius: "50%",
              background: COLOR_INACTIVE, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 11, color: "#fff", fontWeight: 700,
            }}
          >✕</div>
        )}

        <div style={{ width: 1, height: 18, background: COLOR_BORDER, flexShrink: 0 }} />

        {/* Google 로그인 버튼 */}
        <div
          onClick={() => googleUser ? handleGoogleLogout() : handleGoogleLogin()}
          title={googleUser ? `${googleUser.name} (로그아웃)` : "Google 로그인"}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: googleUser ? COLOR_BG : "#fff",
            border: `1px solid ${COLOR_BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
            overflow: "hidden", transition: "all 0.2s",
          }}
        >
          {googleUser
            ? <img src={googleUser.picture} alt={googleUser.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
            : <IconGoogle />
          }
        </div>

        {/* 현위치 버튼 */}
        <div
          onClick={handleMoveToCurrentLoc}
          title="현재 위치로 이동"
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: isLocating ? COLOR_BG : `${COLOR_USER_PIN}18`,
            border: `1px solid ${isLocating ? COLOR_BORDER : COLOR_USER_PIN}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: isLocating ? "default" : "pointer",
            flexShrink: 0, transition: "all 0.2s",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isLocating ? COLOR_TEXT_SUB : COLOR_USER_PIN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            <circle cx="12" cy="12" r="8" strokeOpacity="0.25" />
          </svg>
        </div>
      </div>

      {/* ── 지도 위 오버레이 레이어 */}
      {activeTab === "nearby" && (
        <NearbyMap
          userLat={userLat} userLng={userLng} isLocating={isLocating} locLabel={locLabel}
          radiusMeter={radiusConfig.meter} selectedPlace={selectedPlace} onSelectPlace={handleSelectPlace}
          selectedRadiusIdx={selectedRadiusIdx} onSelectRadius={handleSelectRadius}
          kakaoMapRef={kakaoMapRef} isMapReady={isMapReady}
        />
      )}
      {activeTab === "route" && (
        <RouteMap routeState={routeState} kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} />
      )}

      {/* ── 시트 열렸을 때 지도 딤 처리 */}
      {sheetState !== "hidden" && (
        <div
          onClick={handleCloseSheet}
          style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.08)",
            transition: "opacity 0.3s", pointerEvents: "auto",
          }}
        />
      )}

      {/* ── FAB 메뉴 */}
      <div style={{ position: "absolute", bottom: 32, right: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, zIndex: 50 }}>
        {MENU_ITEM_LIST.map((item, i) => (
          <div
            key={item.id}
            onClick={() => handleMenuSelect(item.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              opacity:       isMenuOpen ? 1 : 0,
              transform:     isMenuOpen ? "translateY(0) scale(1)" : "translateY(16px) scale(0.85)",
              transition:    `opacity 0.22s ease ${i * 0.06}s, transform 0.22s ease ${i * 0.06}s`,
              pointerEvents: isMenuOpen ? "auto" : "none",
              cursor:        "pointer",
            }}
          >
            <div style={{
              background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)",
              borderRadius: 10, padding: "6px 12px",
              fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN,
              boxShadow: "0 2px 12px rgba(0,0,0,0.12)", whiteSpace: "nowrap",
            }}>
              {item.label}
            </div>
            <div style={{
              width: 46, height: 46, borderRadius: "50%",
              background: COLOR_PRIMARY,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 3px 14px rgba(0,0,0,0.18)", flexShrink: 0,
            }}>
              <item.Icon />
            </div>
          </div>
        ))}

        <div
          onClick={() => setIsMenuOpen(prev => !prev)}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: COLOR_PRIMARY,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(245,154,0,0.45)",
            cursor: "pointer", transition: "transform 0.25s ease",
            transform: isMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
            zIndex: 51,
          }}
        >
          <span style={{ fontSize: 26, color: "#fff", lineHeight: 1, fontWeight: 300 }}>+</span>
        </div>
      </div>

      {/* ── 하프 바텀 시트 */}
      <div
        ref={sheetElRef}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          height: `${sheetHeightVh}vh`,
          background: COLOR_SURFACE, borderRadius: "20px 20px 0 0",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.14)",
          transition: isDraggingRef.current ? "none" : "height 0.32s cubic-bezier(0.32,0.72,0,1)",
          zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* 드래그 핸들 */}
        <div
          onTouchStart={e => handleDragStart(e.touches[0].clientY)}
          onTouchEnd={e => handleDragEnd(e.changedTouches[0].clientY)}
          onMouseDown={e => handleDragStart(e.clientY)}
          onMouseUp={e => handleDragEnd(e.clientY)}
          style={{ padding: "12px 0 8px", flexShrink: 0, cursor: "grab", userSelect: "none" }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: COLOR_BORDER, margin: "0 auto" }} />
        </div>

        {/* 시트 헤더 */}
        {activeTab && (
          <div style={{
            padding: "4px 20px 12px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexShrink: 0, borderBottom: `1px solid ${COLOR_BORDER}`,
          }}>
            <div>
              <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, letterSpacing: 2, fontWeight: 600 }}>
                {activeTab === "nearby" ? "NEARBY EXPLORE" : "ROUTE PLANNING"}
              </div>
              <div style={{ fontSize: 17, fontWeight: 900, color: COLOR_TEXT_MAIN, marginTop: 2 }}>
                {activeTab === "nearby" ? "근처 인기 장소 탐색" : "경로 탐색"}
              </div>
            </div>
            <div
              onClick={handleCloseSheet}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: COLOR_BG, border: `1px solid ${COLOR_BORDER}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 16, color: COLOR_TEXT_SUB,
              }}
            >✕</div>
          </div>
        )}

        {/* 시트 콘텐츠 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {activeTab === "nearby" && (
            <div style={{ padding: "12px 16px 24px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {RADIUS_OPTION_LIST.map((opt, i) => (
                  <button
                    key={opt.label}
                    onClick={() => handleSelectRadius(i)}
                    style={{
                      flex: 1, padding: "7px 0", borderRadius: 10,
                      border:     `1.5px solid ${selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_BORDER}`,
                      background: selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_SURFACE,
                      color:      selectedRadiusIdx === i ? "#fff" : COLOR_TEXT_SUB,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s",
                    }}
                  >
                    {opt.label}
                    <div style={{ fontSize: 10, fontWeight: 400, marginTop: 1, opacity: 0.8 }}>
                      {opt.meter >= 1000 ? `${opt.meter / 1000}km` : `${opt.meter}m`}
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span>주변 장소 <span style={{ color: COLOR_PRIMARY }}>{activePlaceList.length}</span></span>
                <span style={{ fontWeight: 400, fontSize: 11 }}>거리순</span>
              </div>

              {activePlaceList.length === 0
                ? <div style={{ textAlign: "center", color: COLOR_INACTIVE, fontSize: 13, padding: 32 }}>반경 내 장소가 없어요</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activePlaceList.map(place => (
                      <PlaceCard
                        key={place.id} place={place}
                        isSelected={selectedPlace?.id === place.id}
                        onSelect={handleSelectPlace}
                      />
                    ))}
                  </div>
              }
            </div>
          )}

          {activeTab === "route" && (
            <RoutePanel
              routeState={routeState}
              onSetOrigin={handleSetOrigin} onSetDest={handleSetDest}
              onSetResult={handleSetRouteResult} onSetLoading={handleSetLoading} onSetError={handleSetError}
              userLat={userLat} userLng={userLng}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RouteScreen;