// ═══════════════════════════════════════════════════════════
// RouteScreen — 앱 루트 화면 (PC/태블릿 좌우 분할 구조)
//
// [구조]
//   Flexbox 좌우 분할 (100vw, 100vh)
//   - 좌측: 사이드바 (고정 너비 420px)
//       - 상단: 탭 (주변 탐색 / 경로 탐색)
//       - 하단: 탭별 콘텐츠 스크롤 영역 (Nearby / RoutePanel)
//   - 우측: 카카오 지도 영역 (flex: 1, relative)
//       - 상단(absolute): 검색창 + 구글 로그인 + 현위치 버튼
//       - 하단(absolute): 재난 경로 선택 모달
//       - 마커, 재난 오버레이, 재난 알림 배너 등 배치
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback, type FC } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import type {
  Tab, Place, UserLocation, Category,
  RoutePoint, RouteState, RouteResult,
} from "../types/type";
import type {
  KakaoLatLng, KakaoLatLngBounds, KakaoMapInstance,
  KakaoCircle, KakaoGeocoder, KakaoMarker, KakaoOverlay, KakaoPolyline,
  KakaoPlaceSearchResult, KakaoPlaces,
} from "../types/type_kakao";
import {
  COLOR_BG, COLOR_BORDER, COLOR_INACTIVE,
  COLOR_PRIMARY, COLOR_SURFACE, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_DANGER,
} from "../colors";

import { useKakaoNearby, haversineM } from "../hooks/Usekakaonearby";
import { useRecommendedRoute, type RecommendedRoute, type DisasterZoneInfo } from "../hooks/Userecommendedroute";
import { useDisasterAlert, type DisasterAlert } from "../hooks/UseDisasterAlert";
import { formatDuration, formatDistance }        from "../utils/Utils";

import PlaceCard        from "./PlaceCard";
import PlaceDetailPanel from "./PlaceDetailPanel";
import DisasterAlertBanner from "./DisasterAlertBanner";
import DisasterStatusChip  from "./DisasterStatusChip";
import DisasterZoneOverlay from "./DisasterZoneOverlay";
import NearbyMap  from "./NearByMap";
import RoutePanel, { buildManualRoutes, drawOnMap, type NavRouteCtx } from "./RoutePanel";
import PlaceMarker from "./PlaceMarker";
import { kakaoResultToPlace } from "../utils/Utils";
import { usePlaceSearch } from "../hooks/UsePlaceSearch";
import { fetchTaLocationId, fetchTaDetail } from "../hooks/Usekakaonearby";
import { useFavorites } from "../hooks/UseFavorites";

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.9780;
const COLOR_USER_PIN      = "#3B7DFF";
const COLOR_USER_PIN_RING = "rgba(59,125,255,0.18)";

const RADIUS_OPTION_LIST = [
  { label: "250m", meter: 250  },
  { label: "500m", meter: 500  },
  { label: "1km",  meter: 1000 },
] as const;

const IconNearby: FC<{color?: string}> = ({color = "currentColor"}) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeOpacity="0.5" />
    <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

const IconRoute: FC<{color?: string}> = ({color = "currentColor"}) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" />
    <path d="M6 17V9a6 6 0 0 1 6-6h2" /><path d="M18 7v8a6 6 0 0 1-6 6H10" />
  </svg>
);

const IconStar: FC<{color?: string}> = ({color = "currentColor"}) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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

const MENU_ITEM_LIST: { id: Tab; Icon: FC<{color?: string}>; label: string }[] = [
  { id: "nearby",    Icon: IconNearby, label: "주변 탐색" },
  { id: "route",     Icon: IconRoute,  label: "경로 탐색" },
  { id: "favorites", Icon: IconStar,   label: "즐겨찾기"  },
];

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
// RouteScreen / Disaster Modal & Helper
// ═══════════════════════════════════════════════════════════

const _haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// 선분 P1→P2와 원 중심 C 사이의 최소 거리 (미터, 평면 근사)
const _segToCircleDist = (
  p1Lat: number, p1Lng: number,
  p2Lat: number, p2Lng: number,
  cLat:  number, cLng:  number,
): number => {
  const cosLat = Math.cos(cLat * Math.PI / 180);
  const s = 111_000;
  const x1 = (p1Lng - cLng) * s * cosLat, y1 = (p1Lat - cLat) * s;
  const x2 = (p2Lng - cLng) * s * cosLat, y2 = (p2Lat - cLat) * s;
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x1, y1);
  const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lenSq));
  return Math.hypot(x1 + t * dx, y1 + t * dy);
};

const routePassesThroughAlert = (route: RecommendedRoute, alert: DisasterAlert): boolean => {
  if (!alert.lat || !alert.lng) return false;
  const radius = alert.radiusM ?? 2000;
  for (const place of route.places) {
    if (_haversineM(place.lat, place.lng, alert.lat, alert.lng) < radius) return true;
  }
  for (const road of route.roads) {
    const v = road.vertexes;
    for (let i = 0; i + 1 < v.length; i += 2) {
      const p1Lat = v[i + 1], p1Lng = v[i];
      const p2Lat = i + 3 < v.length ? v[i + 3] : p1Lat;
      const p2Lng = i + 2 < v.length ? v[i + 2] : p1Lng;
      if (_segToCircleDist(p1Lat, p1Lng, p2Lat, p2Lng, alert.lat, alert.lng) < radius) return true;
    }
  }
  return false;
};

const _isPointInAlert = (lat: number, lng: number, alert: DisasterAlert): boolean => {
  if (!alert.lat || !alert.lng) return false;
  return _haversineM(lat, lng, alert.lat, alert.lng) < (alert.radiusM ?? 2000);
};

// 출발지 근방 선분을 제외하고 경로 본체가 재난구역을 통과하는지 확인
const routeBodyPassesThroughAlert = (
  route: RecommendedRoute,
  alert: DisasterAlert,
  originLat: number,
  originLng: number,
): boolean => {
  if (!alert.lat || !alert.lng) return false;
  const radius = alert.radiusM ?? 2000;
  for (const place of route.places) {
    if (_haversineM(place.lat, place.lng, alert.lat, alert.lng) < radius) return true;
  }
  for (const road of route.roads) {
    const v = road.vertexes;
    for (let i = 0; i + 1 < v.length; i += 2) {
      const p1Lat = v[i + 1], p1Lng = v[i];
      if (_haversineM(p1Lat, p1Lng, originLat, originLng) < radius) continue;
      const p2Lat = i + 3 < v.length ? v[i + 3] : p1Lat;
      const p2Lng = i + 2 < v.length ? v[i + 2] : p1Lng;
      if (_segToCircleDist(p1Lat, p1Lng, p2Lat, p2Lng, alert.lat, alert.lng) < radius) return true;
    }
  }
  return false;
};

const _DST_NAME_EN: Record<string, string> = {
  호우: "Heavy Rain", 교통통제: "Traffic Control", 긴급재난: "Emergency",
};

const _ROUTE_LABEL_EN: Record<string, string> = {
  "맞춤 코스": "Custom Course", "명소 탐방": "Landmarks Tour",
  "맛집 투어": "Food Tour",     "반나절 코스": "Half-Day Course",
};

const _MODAL_CLR: Record<string, { main: string; light: string; border: string }> = {
  호우:     { main: "#2563EB", light: "#EFF6FF", border: "#BFDBFE" },
  교통통제: { main: "#F5A623", light: "#FFFBEB", border: "#FDD99A" },
  긴급재난: { main: COLOR_DANGER, light: "#FFF1F2", border: "#FECDD3" },
};
const _MODAL_ICON: Record<string, string> = { 호우: "🌧️", 교통통제: "🚧", 긴급재난: "🚨" };
const _DST_SEVERITY: Record<string, number> = { 긴급재난: 2, 교통통제: 1, 호우: 0 };
const _fmtDiff = (sec: number, isEn = false) => {
  const sign = sec >= 0 ? "+" : "-";
  const m = Math.round(Math.abs(sec) / 60);
  if (isEn) return m >= 60 ? `${sign}${Math.floor(m / 60)}h ${m % 60}m` : `${sign}${m}m`;
  return m >= 60 ? `${sign}${Math.floor(m / 60)}시간 ${m % 60}분` : `${sign}${m}분`;
};
const _fmtDistDiff = (meter: number) => {
  const sign = meter >= 0 ? "+" : "-";
  const abs  = Math.abs(meter);
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(1)}km` : `${sign}${abs}m`;
};

const ROUTE_COLOR_ORIG   = "#f97316"; 
const ROUTE_COLOR_DETOUR = "#16a34a"; 

const DestinationWarningModal: FC<{
  alerts:    DisasterAlert[];
  onConfirm: () => void;
  onCancel:  () => void;
  isEn?:     boolean;
}> = ({ alerts, onConfirm, onCancel, isEn = false }) => {
  const primary = alerts[0];
  const c = _MODAL_CLR[primary?.dstSeNm ?? '긴급재난'] ?? _MODAL_CLR['긴급재난'];
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 960, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "24px", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: COLOR_SURFACE, borderRadius: "24px", borderTop: `4px solid ${c.border}`, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", padding: "24px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ width: 36, height: 4, background: COLOR_BORDER, borderRadius: 2, margin: "0 auto" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: COLOR_TEXT_MAIN }}>{isEn ? "Destination in Disaster Zone" : "도착지 재난구역 경고"}</div>
            <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginTop: 2 }}>{isEn ? "Your destination is inside a disaster zone" : "선택한 도착지가 재난 구역에 포함됩니다"}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alerts.map(alert => {
            const ac = _MODAL_CLR[alert.dstSeNm] ?? _MODAL_CLR['긴급재난'];
            return (
              <div key={alert.id} style={{ background: ac.light, borderRadius: 10, padding: "10px 14px", border: `1px solid ${ac.border}`, fontSize: 12, color: COLOR_TEXT_MAIN, lineHeight: 1.65 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ background: ac.main, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10 }}>{_MODAL_ICON[alert.dstSeNm]} {isEn ? _DST_NAME_EN[alert.dstSeNm] : alert.dstSeNm}</span>
                  <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{alert.rcptnRgnNm} · {alert.crtDt}</span>
                </div>
                {alert.summary}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: COLOR_TEXT_MAIN, lineHeight: 1.65, background: "#fff7ed", borderRadius: 10, padding: "10px 14px", border: "1px solid #fed7aa" }}>
          {isEn
            ? "Your destination is inside a disaster zone. Please verify safety before traveling. Continue anyway?"
            : "도착지가 재난 구역 안에 있습니다. 이동 전 현장 안전 여부를 꼭 확인하세요. 그래도 이동하시겠습니까?"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, color: COLOR_TEXT_SUB, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>{isEn ? "Cancel" : "취소"}</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: COLOR_DANGER, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>{isEn ? "Continue Anyway" : "그래도 이동"}</button>
        </div>
      </div>
    </div>
  );
};

const DisasterRouteChoiceModal: FC<{
  route:          RecommendedRoute;
  alerts:         DisasterAlert[];
  detourRoutes:   RecommendedRoute[];
  detourLoading:  boolean;
  destInZone:     boolean;
  onKeep:         () => void;
  onDetour:       () => void;
  onSelectDetour: (r: RecommendedRoute) => void;
  onPreviewDetour:(d: RecommendedRoute | null) => void;
  onClose:        () => void;
  isEn?:          boolean;
}> = ({ route, alerts, detourRoutes, detourLoading, destInZone, onKeep, onDetour, onSelectDetour, onPreviewDetour, onClose, isEn = false }) => {
  const [comparing,     setComparing]     = useState(false);
  const [selectedDetour, setSelectedDetour] = useState<RecommendedRoute | null>(null);

  const primary = alerts.reduce((a, b) =>
    (_DST_SEVERITY[a.dstSeNm] ?? 0) >= (_DST_SEVERITY[b.dstSeNm] ?? 0) ? a : b
  );
  const c = _MODAL_CLR[primary.dstSeNm] ?? _MODAL_CLR["긴급재난"];
  const matchedDetour = detourRoutes.find(d => d.label === route.label) ?? null;

  const handleDetourClick = () => { setComparing(true); setSelectedDetour(null); onPreviewDetour(null); onDetour(); };
  const handleBack = () => { setComparing(false); setSelectedDetour(null); onPreviewDetour(null); };
  const handleCardClick = (detour: RecommendedRoute) => {
    const next = selectedDetour?.label === detour.label ? null : detour;
    setSelectedDetour(next);
    onPreviewDetour(next);
  };

  return (
    <>
      <style>{`
        @keyframes disasterModalUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      
      {/* 1. 사이드바 영역(relative) 내부에 꽉 차는 반투명 배경 + 사방 24px 여백 */}
      <div onClick={comparing ? undefined : onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 960, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "24px", fontFamily: "'Noto Sans KR', sans-serif" }}>
        
        {/* 2. 플로팅 카드 스타일 (사이드바 내부 크기에 맞춰 maxHeight 조정) */}
        <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: COLOR_SURFACE, borderRadius: "24px", borderTop: `4px solid ${c.border}`, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", maxHeight: "calc(100% - 48px)", display: "flex", flexDirection: "column", animation: "disasterModalUp 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
          
          <div style={{ padding: "16px 20px 10px", flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, background: COLOR_BORDER, borderRadius: 2, margin: "0 auto 16px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {comparing && <button onClick={handleBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "0 4px 0 0", color: COLOR_TEXT_SUB, lineHeight: 1 }}>←</button>}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.main, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                  <span>{_MODAL_ICON[primary.dstSeNm]}</span>
                  <span>{comparing
                    ? (isEn ? "Compare Detour Routes" : "우회 경로 비교")
                    : alerts.length > 1
                      ? (isEn ? `${alerts.length} Disaster Alerts` : `재난 ${alerts.length}건 경고`)
                      : (isEn ? `${_DST_NAME_EN[primary.dstSeNm]} Alert` : `${primary.dstSeNm} 경고`)
                  }</span>
                </div>
              </div>
              <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, color: COLOR_TEXT_SUB, cursor: "pointer" }}>✕</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 32px" }}>
            {!comparing ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {alerts.map(alert => {
                    const ac = _MODAL_CLR[alert.dstSeNm] ?? _MODAL_CLR["긴급재난"];
                    return (
                      <div key={alert.id} style={{ background: ac.light, borderRadius: 12, padding: "10px 14px", border: `1px solid ${ac.border}`, fontSize: 12, color: COLOR_TEXT_MAIN, lineHeight: 1.65 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: ac.main, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10 }}>
                            <span>{_MODAL_ICON[alert.dstSeNm]}</span><span>{isEn ? _DST_NAME_EN[alert.dstSeNm] : alert.dstSeNm}</span>
                          </span>
                          <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{alert.rcptnRgnNm} · {alert.crtDt}</span>
                        </div>
                        {alert.summary}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, marginBottom: 10 }}>
                  {isEn
                    ? `Your route passes through ${alerts.length} disaster zone${alerts.length > 1 ? "s" : ""}`
                    : `선택한 경로가 ${alerts.length}개의 재난 구역을 통과합니다`}
                </div>
                {destInZone && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                    <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
                      {isEn
                        ? <><strong>Your destination is inside a disaster zone.</strong><br />Even with a detour, the destination itself is in the affected area.</>
                        : <><strong>도착지가 재난 구역에 포함됩니다.</strong><br />우회 경로를 선택해도 목적지 자체가 재난 구역 안에 있으니 주의하세요.</>}
                    </div>
                  </div>
                )}
                <div style={{ background: COLOR_BG, borderRadius: 10, padding: "10px 14px", marginBottom: 16, border: `1px solid ${COLOR_BORDER}`, display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 20 }}>{route.emoji}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN }}>{route.label}</div>
                    {route.totalDuration > 0 && <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginTop: 2 }}>{formatDuration(route.totalDuration)} · {formatDistance(route.totalDistance)}</div>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button onClick={handleDetourClick} style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: `1.5px solid ${c.border}`, background: c.light, cursor: "pointer", fontSize: 14, fontWeight: 700, color: c.main, fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {isEn ? "🗺 Compare Detour Routes (Avoid Disaster Zones)" : "🗺 재난 구역 제외 우회 경로 비교"}
                  </button>
                  <button onClick={onKeep} style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, cursor: "pointer", fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN, fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {isEn ? "Keep Current Route (Pass Through Disaster Zone)" : "현재 경로 유지 (재난 구간 통과)"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 10, height: 3, borderRadius: 2, background: ROUTE_COLOR_ORIG }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: ROUTE_COLOR_ORIG }}>{isEn ? "Current Route" : "현재 선택 경로"}</span>
                  </div>
                  <div style={{ background: "#fff7ed", borderRadius: 12, padding: "12px 14px", border: `1.5px solid #fed7aa`, display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{ fontSize: 22, marginTop: 2 }}>{route.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: COLOR_TEXT_MAIN }}>{route.label}</span>
                        <span style={{ fontSize: 9, background: ROUTE_COLOR_ORIG, color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{isEn ? "⚠ Disaster Zone" : "⚠ 재난구역 통과"}</span>
                      </div>
                      {route.totalDuration > 0 && (
                        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: ROUTE_COLOR_ORIG }}>{formatDuration(route.totalDuration, isEn)}</span>
                          <span style={{ fontSize: 12, color: COLOR_TEXT_SUB, alignSelf: "flex-end" }}>{formatDistance(route.totalDistance)}</span>
                          {route.taxiFare > 0 && <span style={{ fontSize: 11, color: COLOR_TEXT_SUB, alignSelf: "flex-end" }}>🚕 {isEn ? `₩${route.taxiFare.toLocaleString()}` : `${route.taxiFare.toLocaleString()}원`}</span>}
                        </div>
                      )}
                      {route.places.length > 0 && <div style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{route.places.map(p => p.name).join(" → ")}</div>}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <div style={{ flex: 1, height: 1, background: COLOR_BORDER }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 10, height: 3, borderRadius: 2, background: ROUTE_COLOR_DETOUR }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: ROUTE_COLOR_DETOUR, whiteSpace: "nowrap" }}>{isEn ? "Detour Candidates" : "우회 경로 후보"}</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: COLOR_BORDER }} />
                </div>

                {detourLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0", color: COLOR_TEXT_SUB }}>
                    <div style={{ width: 28, height: 28, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <span style={{ fontSize: 13 }}>{isEn ? `Finding detour for ${_ROUTE_LABEL_EN[route.label] ?? route.label}...` : `${route.label} 우회 코스 탐색 중...`}</span>
                  </div>
                ) : !matchedDetour ? (
                  <div style={{ textAlign: "center", color: COLOR_TEXT_SUB, fontSize: 13, padding: "24px 0" }}>{isEn ? "No detour found for this route" : "동일 코스의 우회 경로를 찾지 못했습니다"}</div>
                ) : (() => {
                  const detour = matchedDetour;
                  const dSec  = detour.totalDuration  - route.totalDuration;
                  const dDist = detour.totalDistance  - route.totalDistance;
                  const isSelected = selectedDetour?.label === detour.label;
                  return (
                    <div>
                      <div onClick={() => handleCardClick(detour)} style={{ borderRadius: 14, border: `2px solid ${isSelected ? ROUTE_COLOR_DETOUR : COLOR_BORDER}`, background: isSelected ? "#f0fdf4" : COLOR_SURFACE, padding: "14px 16px", cursor: "pointer", transition: "all 0.18s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 20 }}>{detour.emoji}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: COLOR_TEXT_MAIN }}>{detour.label}</span>
                              <span style={{ fontSize: 9, background: ROUTE_COLOR_DETOUR, color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{isEn ? "✓ Safe Detour" : "✓ 안전 우회"}</span>
                            </div>
                            <div style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{detour.description}</div>
                          </div>
                          <span style={{ fontSize: 11, color: isSelected ? ROUTE_COLOR_DETOUR : COLOR_TEXT_SUB, fontWeight: isSelected ? 700 : 400 }}>{isSelected ? (isEn ? "▲ Collapse" : "▲ 접기") : (isEn ? "▼ Details" : "▼ 상세")}</span>
                        </div>
                        {detour.totalDuration > 0 && (
                          <div style={{ display: "flex", gap: 14, alignItems: "baseline", marginBottom: 6 }}>
                            <div>
                              <span style={{ fontSize: 15, fontWeight: 800, color: ROUTE_COLOR_DETOUR }}>{formatDuration(detour.totalDuration, isEn)}</span>
                              <span style={{ fontSize: 11, marginLeft: 4, fontWeight: 700, color: dSec <= 0 ? ROUTE_COLOR_DETOUR : "#f59e0b" }}>({_fmtDiff(dSec, isEn)})</span>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>{formatDistance(detour.totalDistance)}</span>
                              <span style={{ fontSize: 10, marginLeft: 3, fontWeight: 600, color: dDist <= 0 ? ROUTE_COLOR_DETOUR : "#f59e0b" }}>({_fmtDistDiff(dDist)})</span>
                            </div>
                            {detour.taxiFare > 0 && <span style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>🚕 {isEn ? `₩${detour.taxiFare.toLocaleString()}` : `${detour.taxiFare.toLocaleString()}원`}</span>}
                          </div>
                        )}
                        {!isSelected && detour.places.length > 0 && (
                          <div style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{detour.places.slice(0, 3).map(p => p.name).join(" → ")}{detour.places.length > 3 ? " ..." : ""}</div>
                        )}
                      </div>

                      {isSelected && (
                        <div style={{ marginTop: 10, borderRadius: 14, border: `1px solid ${COLOR_BORDER}`, overflow: "hidden" }}>
                          <div style={{ background: COLOR_BG, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 20, borderBottom: `1px solid ${COLOR_BORDER}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 18, height: 3, borderRadius: 2, background: ROUTE_COLOR_ORIG }} /><span style={{ fontSize: 10, fontWeight: 700, color: ROUTE_COLOR_ORIG }}>{isEn ? "Current" : "현재 경로"}</span></div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 18, height: 3, borderRadius: 2, background: ROUTE_COLOR_DETOUR }} /><span style={{ fontSize: 10, fontWeight: 700, color: ROUTE_COLOR_DETOUR }}>{isEn ? "Detour" : "우회 경로"}</span></div>
                          </div>
                          <div style={{ display: "flex" }}>
                            <div style={{ flex: 1, padding: "12px 12px", borderRight: `1px solid ${COLOR_BORDER}` }}>
                              <span style={{ fontSize: 9, background: ROUTE_COLOR_ORIG, color: "#fff", padding: "1px 5px", borderRadius: 4, fontWeight: 700, display: "inline-block", marginBottom: 8 }}>{isEn ? "⚠ Disaster Zone" : "⚠ 재난구역 통과"}</span>
                              {route.totalDuration > 0 && (
                                <>
                                  <div style={{ fontSize: 16, fontWeight: 800, color: ROUTE_COLOR_ORIG }}>{formatDuration(route.totalDuration, isEn)}</div>
                                  <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginBottom: 10 }}>{formatDistance(route.totalDistance)}{route.taxiFare > 0 ? ` · 🚕${isEn ? `₩${route.taxiFare.toLocaleString()}` : `${route.taxiFare.toLocaleString()}원`}` : ""}</div>
                                </>
                              )}
                              <div style={{ fontSize: 10, color: COLOR_TEXT_SUB, lineHeight: 1.9 }}>{route.places.map((p, i) => <div key={i}>📍 {p.name}</div>)}</div>
                            </div>
                            <div style={{ flex: 1, padding: "12px 12px" }}>
                              <span style={{ fontSize: 9, background: ROUTE_COLOR_DETOUR, color: "#fff", padding: "1px 5px", borderRadius: 4, fontWeight: 700, display: "inline-block", marginBottom: 8 }}>{isEn ? "✓ Safe Detour" : "✓ 안전 우회"}</span>
                              {detour.totalDuration > 0 && (
                                <>
                                  <div style={{ fontSize: 16, fontWeight: 800, color: ROUTE_COLOR_DETOUR }}>{formatDuration(detour.totalDuration, isEn)}</div>
                                  <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginBottom: 10 }}>{formatDistance(detour.totalDistance)}{detour.taxiFare > 0 ? ` · 🚕${isEn ? `₩${detour.taxiFare.toLocaleString()}` : `${detour.taxiFare.toLocaleString()}원`}` : ""}</div>
                                </>
                              )}
                              <div style={{ fontSize: 10, color: COLOR_TEXT_SUB, lineHeight: 1.9 }}>{detour.places.map((p, i) => <div key={i}>📍 {p.name}</div>)}</div>
                            </div>
                          </div>
                          <div style={{ padding: "12px 14px", borderTop: `1px solid ${COLOR_BORDER}` }}>
                            <button onClick={() => onSelectDetour(detour)} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: ROUTE_COLOR_DETOUR, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>{isEn ? "🗺 Start with This Route" : "🗺 이 경로로 안내 시작"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const RouteScreen: FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("nearby");
  const [isEn, setIsEn] = useState(false);

  const [isNavigating,    setIsNavigating]    = useState<boolean>(false);
  const [navRoute,        setNavRoute]        = useState<RecommendedRoute | null>(null);
  const [navIsRecommend,  setNavIsRecommend]  = useState<boolean>(false);
  const [navCtx,          setNavCtx]          = useState<NavRouteCtx | null>(null);
  const [navDisasterToast, setNavDisasterToast] = useState<string | null>(null);
  const [isAutoRerouting,  setIsAutoRerouting]  = useState<boolean>(false);

  const handledNavAlertIdsRef  = useRef<Set<string>>(new Set());
  const navToastTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRerouteLoadedRef   = useRef<boolean>(false);
  const isAutoReroutingRef     = useRef<boolean>(false);

  const [pendingNavRoute,      setPendingNavRoute]      = useState<RecommendedRoute | null>(null);
  const [pendingNavAlerts,     setPendingNavAlerts]     = useState<DisasterAlert[]>([]);
  const [pendingNavCtx,        setPendingNavCtx]        = useState<NavRouteCtx | null>(null);
  const [showDisasterModal,    setShowDisasterModal]    = useState<boolean>(false);
  const [detourDisasterZones,  setDetourDisasterZones]  = useState<DisasterZoneInfo[]>([]);

  const [detourManualRoutes,   setDetourManualRoutes]   = useState<RecommendedRoute[]>([]);
  const [detourManualLoading,  setDetourManualLoading]  = useState<boolean>(false);
  const [showDestWarning,      setShowDestWarning]      = useState<boolean>(false);
  const [detourDestInZone,     setDetourDestInZone]     = useState<boolean>(false);
  const [detourCategoryBias,   setDetourCategoryBias]   = useState<Partial<Record<string, number>> | undefined>();
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(null);
  const { favorites, toggle: toggleFavorite, isFavorited } = useFavorites(googleUser?.email ?? null);

  const [selectedRadiusIdx,    setSelectedRadiusIdx]    = useState<number>(1);
  const [selectedPlace,        setSelectedPlace]        = useState<Place | null>(null);
  const [detailPlace,          setDetailPlace]          = useState<Place | null>(null);
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

  const polylineListRef = useRef<KakaoPolyline[]>([]);
  const overlayListRef  = useRef<KakaoOverlay[]>([]);

  const { lat: userLat, lng: userLng, isLocating, locLabel } = useUserLocation();
  const radiusConfig  = RADIUS_OPTION_LIST[selectedRadiusIdx];

  const { currentAlert, alertQueue, remainingSec, dismissCurrent } = useDisasterAlert(false, isEn);
  const activeAlerts = alertQueue;

  const nearbyDisasterZones: DisasterZoneInfo[] = activeAlerts
    .filter(a => {
      if (a.lat == null || a.lng == null) return false;
      // 재난 구역이 주변 탐색 반경과 겹칠 때만 포함
      return haversineM(userLat, userLng, a.lat, a.lng) < radiusConfig.meter + (a.radiusM ?? 2000);
    })
    .map(a => ({ lat: a.lat!, lng: a.lng!, radius_m: a.radiusM ?? 2000 }));

  const { placeList: kakaoPlaceList, isLoading: kakaoIsLoading, error: kakaoError, refetch: kakaoRefetch } =
    useKakaoNearby({ userLat, userLng, radiusMeter: radiusConfig.meter, enabled: activeTab === "nearby" && !isLocating && isServicesReady, disasterZones: nearbyDisasterZones });

  const { routes: recRoutes, isLoading: recIsLoading, error: recError, refetch: recRefetch } =
    useRecommendedRoute({ userLat, userLng, enabled: activeTab === "route" && !isLocating && isServicesReady, disasterZones: detourDisasterZones, categoryBias: detourCategoryBias });

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

  const handlePreviewDetour = useCallback((detour: RecommendedRoute | null) => {
    clearMapLayers();
    if (!kakaoMapRef.current || !isMapReady) return;

    // detour = null: 비교 창 닫기/뒤로 가기 시 원본 경로 복원
    if (!detour) {
      if (pendingNavRoute && pendingNavRoute.roads.length > 0) {
        const isManual = pendingNavCtx?.type === 'manual';
        const waypoints = (isManual ? pendingNavRoute.places : pendingNavRoute.places.slice(0, -1))
          .map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
        drawOnMap(pendingNavRoute.roads, waypoints, kakaoMapRef, polylineListRef, overlayListRef);
      }
      return;
    }

    if (!pendingNavRoute) return;
    const map = kakaoMapRef.current;

    const drawRoute = (roads: RecommendedRoute["roads"], color: string, style: string) => {
      roads.forEach(road => {
        const path: object[] = [];
        for (let i = 0; i < road.vertexes.length - 1; i += 2)
          path.push(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
        if (path.length < 2) return;
        polylineListRef.current.push(new window.kakao.maps.Polyline({
          map, path, strokeWeight: 6, strokeColor: color, strokeOpacity: style === "solid" ? 0.9 : 0.7, strokeStyle: style,
        }));
      });
    };
    drawRoute(pendingNavRoute.roads, ROUTE_COLOR_ORIG,   "shortdot");
    drawRoute(detour.roads,          ROUTE_COLOR_DETOUR, "solid");

    const addLabel = (roads: RecommendedRoute["roads"], text: string, color: string) => {
      const allV = roads.flatMap(r => r.vertexes);
      if (allV.length < 4) return;
      const mi = Math.floor((allV.length / 4)) * 2;
      const el = document.createElement("div");
      el.innerHTML = `<div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;font-family:'Noto Sans KR',sans-serif;">${text}</div>`;
      overlayListRef.current.push(new window.kakao.maps.CustomOverlay({
        map, content: el, zIndex: 20, position: new window.kakao.maps.LatLng(allV[mi + 1], allV[mi]),
      }));
    };
    addLabel(pendingNavRoute.roads, "🟠 현재 경로", ROUTE_COLOR_ORIG);
    addLabel(detour.roads,          "🟢 우회 경로", ROUTE_COLOR_DETOUR);

    const bounds = new window.kakao.maps.LatLngBounds();
    [...pendingNavRoute.roads, ...detour.roads].forEach(road => {
      for (let i = 0; i < road.vertexes.length - 1; i += 2)
        bounds.extend(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
    });
    map.setBounds(bounds, 60, 60, 60, 520);
  }, [clearMapLayers, pendingNavRoute, pendingNavCtx, kakaoMapRef, isMapReady, polylineListRef, overlayListRef]);

  const handleMoveToCurrentLoc = useCallback(() => {
    if (!kakaoMapRef.current || !isMapReady) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(userLat, userLng));
  }, [userLat, userLng, isMapReady]);

  const handleMenuSelect = useCallback((tab: Tab) => {
    if (tab !== activeTab) {
      clearMapLayers();
      if (isNavigating) {
        setIsNavigating(false);
        setNavRoute(null);
        setNavIsRecommend(false);
        setNavCtx(null);
        setIsAutoRerouting(false);
        isAutoReroutingRef.current = false;
        handledNavAlertIdsRef.current = new Set();
        if (navToastTimerRef.current) clearTimeout(navToastTimerRef.current);
        setNavDisasterToast(null);
        setDetourDisasterZones([]);
        setDetourCategoryBias(undefined);
      }
    }
    setActiveTab(tab);
  }, [activeTab, clearMapLayers, isNavigating]);

  const handleStartNavigation = useCallback((route: RecommendedRoute, ctx: NavRouteCtx) => {
    const originLat = ctx.type === 'manual' ? ctx.origin.lat : userLat;
    const originLng = ctx.type === 'manual' ? ctx.origin.lng : userLng;
    const lastPlace = route.places[route.places.length - 1];
    const destLat   = ctx.type === 'manual' ? ctx.dest.lat : (lastPlace?.lat ?? userLat);
    const destLng   = ctx.type === 'manual' ? ctx.dest.lng : (lastPlace?.lng ?? userLng);

    const affected = activeAlerts.filter(a => routePassesThroughAlert(route, a));
    if (affected.length > 0) {
      const bodyAffected = affected.filter(a =>
        routeBodyPassesThroughAlert(route, a, originLat, originLng)
      );
      const destAffected = affected.filter(a => _isPointInAlert(destLat, destLng, a));

      if (bodyAffected.length === 0) {
        // 출발지만 재난구역에 포함된 경우
        if (destAffected.length > 0) {
          // 도착지도 재난구역 → 경고 모달
          setPendingNavRoute(route);
          setPendingNavAlerts(destAffected);
          setPendingNavCtx(ctx);
          setShowDestWarning(true);
        } else {
          // 출발지만 재난구역 → 우회 없이 바로 안내
          setNavRoute(route);
          setIsNavigating(true);
          setNavIsRecommend(ctx.type === 'recommend');
          setNavCtx(ctx);
          handledNavAlertIdsRef.current = new Set();
        }
        return;
      }

      // 경로 본체가 재난구역 통과
      const isDestInZone = destAffected.length > 0;
      setPendingNavRoute(route);
      setPendingNavAlerts(bodyAffected);
      setPendingNavCtx(ctx);
      setDetourDestInZone(isDestInZone);
      setShowDisasterModal(true);
    } else {
      setNavRoute(route);
      setIsNavigating(true);
      setNavIsRecommend(ctx.type === 'recommend');
      setNavCtx(ctx);
      handledNavAlertIdsRef.current = new Set();
    }
  }, [activeAlerts, userLat, userLng]);

  const handleConfirmNavigation = useCallback(() => {
    if (!pendingNavRoute) return;
    setNavRoute(pendingNavRoute);
    setIsNavigating(true);
    setNavIsRecommend(pendingNavCtx?.type === 'recommend');
    setNavCtx(pendingNavCtx);
    // 사용자가 재난을 인지하고 기존 경로를 선택했으므로 현재 활성 알림 전부를 처리된 것으로 표시
    handledNavAlertIdsRef.current = new Set(activeAlerts.map(a => a.id));
    setShowDisasterModal(false);
    setPendingNavRoute(null);
    setPendingNavAlerts([]);
    setPendingNavCtx(null);
    setDetourDisasterZones([]);
    setDetourManualRoutes([]);
    setDetourDestInZone(false);
    setDetourCategoryBias(undefined);
  }, [pendingNavRoute, pendingNavCtx, activeAlerts]);

  const handleConfirmDestWarning = useCallback(() => {
    if (!pendingNavRoute) return;
    setNavRoute(pendingNavRoute);
    setIsNavigating(true);
    setNavIsRecommend(pendingNavCtx?.type === 'recommend');
    setNavCtx(pendingNavCtx);
    handledNavAlertIdsRef.current = new Set();
    setShowDestWarning(false);
    setPendingNavRoute(null);
    setPendingNavAlerts([]);
    setPendingNavCtx(null);
  }, [pendingNavRoute, pendingNavCtx]);

  const handleCancelDestWarning = useCallback(() => {
    setShowDestWarning(false);
    setPendingNavRoute(null);
    setPendingNavAlerts([]);
    setPendingNavCtx(null);
  }, []);

  const handleDetourSearch = useCallback(async () => {
    const zones: DisasterZoneInfo[] = activeAlerts
      .filter(a => a.lat && a.lng)
      .map(a => ({ lat: a.lat!, lng: a.lng!, radius_m: a.radiusM ?? 2000 }));

    // 원본 코스의 지배 카테고리 파악 → 우회 탐색 시 해당 카테고리 후보를 2배 샘플링해 코스 성격 유지
    const places = pendingNavRoute?.places ?? [];
    const catCounts: Partial<Record<Category, number>> = {};
    for (const p of places) catCounts[p.category] = (catCounts[p.category] ?? 0) + 1;
    const dominantCat = (Object.entries(catCounts) as [Category, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    setDetourDisasterZones(zones);

    if (pendingNavCtx?.type === 'manual') {
      setDetourManualLoading(true);
      setDetourManualRoutes([]);
      try {
        const routes = await buildManualRoutes(pendingNavCtx.origin, pendingNavCtx.dest, zones, dominantCat);
        setDetourManualRoutes(routes);
      } catch (e) {
        console.error("[DetourSearch] 직접 입력 우회 경로 탐색 실패:", e);
      } finally {
        setDetourManualLoading(false);
      }
    } else {
      setDetourCategoryBias(dominantCat ? { [dominantCat]: 5 } : undefined);
      recRefetch();
    }
  }, [activeAlerts, pendingNavCtx, pendingNavRoute, recRefetch]);

  const handleSelectDetour = useCallback((detourRoute: RecommendedRoute) => {
    clearMapLayers();
    const isManual = pendingNavCtx?.type === 'manual';
    if (kakaoMapRef.current && isMapReady && detourRoute.roads.length > 0) {
      const waypoints = (isManual ? detourRoute.places : detourRoute.places.slice(0, -1))
        .map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
      drawOnMap(detourRoute.roads, waypoints, kakaoMapRef, polylineListRef, overlayListRef);
    }
    setNavRoute(detourRoute);
    setIsNavigating(true);
    setNavIsRecommend(!isManual);
    setNavCtx(pendingNavCtx);
    // 사용자가 우회 경로를 의식적으로 선택했으므로 현재 활성 알림 전부를 처리된 것으로 표시
    handledNavAlertIdsRef.current = new Set(activeAlerts.map(a => a.id));
    setShowDisasterModal(false);
    setPendingNavRoute(null);
    setPendingNavAlerts([]);
    setPendingNavCtx(null);
    setDetourDisasterZones([]);
    setDetourManualRoutes([]);
    setDetourDestInZone(false);
    setDetourCategoryBias(undefined);
  }, [clearMapLayers, kakaoMapRef, isMapReady, pendingNavCtx, polylineListRef, overlayListRef, activeAlerts]);

  const handleCancelNavigation = useCallback(() => {
    setIsNavigating(false);
    setNavRoute(null);
    setNavIsRecommend(false);
    setNavCtx(null);
    setIsAutoRerouting(false);
    isAutoReroutingRef.current = false;
    handledNavAlertIdsRef.current = new Set();
    if (navToastTimerRef.current) clearTimeout(navToastTimerRef.current);
    setNavDisasterToast(null);
    setDetourDisasterZones([]);
    setDetourCategoryBias(undefined);
    clearMapLayers();
  }, [clearMapLayers]);

  // ── 안내 중 실시간 재난 감지 & 자동 우회 ────────────────────
  useEffect(() => {
    if (!isNavigating || !navRoute || isAutoReroutingRef.current) return;

    const newlyAffected = activeAlerts.filter(a =>
      !handledNavAlertIdsRef.current.has(a.id) &&
      routePassesThroughAlert(navRoute, a)
    );
    if (newlyAffected.length === 0) return;

    newlyAffected.forEach(a => handledNavAlertIdsRef.current.add(a.id));

    // 토스트 알림 표시 (5초 후 자동 해제)
    if (navToastTimerRef.current) clearTimeout(navToastTimerRef.current);
    setNavDisasterToast(isEn ? "Disaster zone detected on route. Rerouting to safe detour." : "경로에 재난 구역이 발생했습니다. 우회 경로로 재안내합니다.");
    navToastTimerRef.current = setTimeout(() => setNavDisasterToast(null), 5000);

    const zones: DisasterZoneInfo[] = newlyAffected
      .filter(a => a.lat != null && a.lng != null)
      .map(a => ({ lat: a.lat!, lng: a.lng!, radius_m: a.radiusM ?? 2000 }));

    const catCounts: Partial<Record<Category, number>> = {};
    for (const p of navRoute.places) catCounts[p.category] = (catCounts[p.category] ?? 0) + 1;
    const dominantCat = (Object.entries(catCounts) as [Category, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0] as Category | undefined;

    isAutoReroutingRef.current = true;
    setIsAutoRerouting(true);
    setDetourDisasterZones(zones);

    if (!navIsRecommend && navCtx?.type === 'manual') {
      // 직접 입력: 원래 출발지 → 원래 목적지로 우회 경로 즉시 계산
      buildManualRoutes(navCtx.origin, navCtx.dest, zones, dominantCat)
        .then(routes => {
          if (routes.length === 0) return;
          clearMapLayers();
          const r = routes[0];
          if (kakaoMapRef.current && isMapReady) {
            drawOnMap(r.roads, r.places.map(p => ({ lat: p.lat, lng: p.lng, name: p.name })), kakaoMapRef, polylineListRef, overlayListRef);
          }
          setNavRoute(r);
        })
        .catch(e => console.error("[AutoDetour] 직접 입력 우회 실패:", e))
        .finally(() => { isAutoReroutingRef.current = false; setIsAutoRerouting(false); });
    } else {
      // 추천 경로: detourDisasterZones 갱신 + recRefetch → autoRerouteLoadedRef로 완료 감지
      autoRerouteLoadedRef.current = false;
      setDetourCategoryBias(dominantCat ? { [dominantCat]: 5 } : undefined);
      recRefetch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlerts, isNavigating]);

  // 추천 경로 자동 우회: loading → 완료 전환 시 첫 번째 경로로 교체
  useEffect(() => {
    if (!isAutoRerouting || !navIsRecommend) return;

    if (recIsLoading) {
      autoRerouteLoadedRef.current = true; // 로딩 시작 확인
      return;
    }
    if (!autoRerouteLoadedRef.current) return; // 아직 로딩 시작 전

    autoRerouteLoadedRef.current = false;
    isAutoReroutingRef.current = false;
    setIsAutoRerouting(false);

    if (recRoutes.length === 0) return;
    const best = recRoutes[0];
    clearMapLayers();
    if (kakaoMapRef.current && isMapReady) {
      const waypoints = best.places.slice(0, -1).map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
      drawOnMap(best.roads, waypoints, kakaoMapRef, polylineListRef, overlayListRef);
    }
    setNavRoute(best);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoRerouting, navIsRecommend, recIsLoading, recRoutes]);

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
        const data = { ...(prev?.data ?? {}), rating };
        localStorage.setItem(`ta_${id}`, JSON.stringify({ data, ts: Date.now() }));
      } catch { }
    };

    let cancelled = false;
    const targets = searchResults.slice(0, 10);
    const fromCache: Record<string, number> = {};
    targets.forEach(r => {
      const cached = readCache(r.id);
      if (cached !== undefined) fromCache[r.id] = cached;
    });
    if (Object.keys(fromCache).length > 0) setSearchRatings(fromCache);

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

  const handleSelectPlace        = (place: Place | null) => setSelectedPlace(prev => prev?.id === place?.id ? null : place);
  const handleSelectPlaceFromMap = (place: Place | null) => {
    setSelectedPlace(prev => prev?.id === place?.id ? null : place);
    if (place) setDetailPlace(place);
  };
  const handleSelectRadius = (idx: number) => {
    setSelectedRadiusIdx(idx);
    setSelectedPlace(null);
    // 반경이 바뀌면 캐시 무시하고 즉시 재탐색
    kakaoRefetch();
  };
  const handleSetOrigin    = (p: RoutePoint | null) => setRouteState(prev => ({ ...prev, origin: p }));
  const handleSetDest      = (p: RoutePoint | null) => setRouteState(prev => ({ ...prev, destination: p }));
  const handleSetResult    = (r: RouteResult | null) => setRouteState(prev => ({ ...prev, result: r }));
  const handleSetLoading   = (v: boolean) => setRouteState(prev => ({ ...prev, isLoading: v }));
  const handleSetError     = (m: string)  => setRouteState(prev => ({ ...prev, errorMsg: m }));

 // ═══════════════════════════════════════════════════════════
  // RENDER - Flexbox 기반의 좌우 분할 레이아웃
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", fontFamily: "'Noto Sans KR', sans-serif", background: "#000", overflow: "hidden" }}>
      {/* 전역 keyframe — 조건부 컴포넌트에 묻히지 않도록 항상 렌더 */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      
      {/* ── [LEFT SIDEBAR] ─────────────────────────────── */}
      {/* [수정됨] 사이드바 패널에 position: "relative"를 추가하여 모달의 기준점으로 만듦 */}
      <div style={{ position: "relative", width: "420px", display: "flex", flexDirection: "column", background: COLOR_SURFACE, zIndex: 40, boxShadow: "4px 0 24px rgba(0,0,0,0.12)" }}>
        
        {/* ── 서비스 로고 영역 ── */}
        <div style={{ padding: "24px 20px 8px", display: "flex", alignItems: "center", gap: 12 }}>
          <img src="./Lin-K-transparent.png" alt="Logo" style={{ width: 42, height: 42, borderRadius: 12 }} />
          {/* 서비스명 타이틀 (필요 없으면 삭제 가능) */}
          <div style={{ fontSize: 22, fontWeight: 900, color: COLOR_TEXT_MAIN, letterSpacing: "-0.5px" }}>
            Lin-K
          </div>
        </div>

        {/* 메뉴 탭 (주변 탐색 / 경로 탐색 / 즐겨찾기) + EN 토글 */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOR_BORDER}`, padding: "0 12px 0 20px", alignItems: "center" }}>
          {MENU_ITEM_LIST.map(item => {
            const isActive = activeTab === item.id;
            const label = isEn
              ? ({ nearby: "Nearby", route: "Route", favorites: "Favorites" } as Record<string, string>)[item.id]
              : item.label;
            return (
              <button
                key={item.id}
                onClick={() => handleMenuSelect(item.id)}
                style={{
                  flex: 1, padding: "14px 0", border: "none", background: "transparent",
                  borderBottom: isActive ? `3px solid ${COLOR_PRIMARY}` : `3px solid transparent`,
                  color: isActive ? COLOR_PRIMARY : COLOR_TEXT_SUB,
                  fontWeight: isActive ? 800 : 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s"
                }}
              >
                <item.Icon color={isActive ? COLOR_PRIMARY : COLOR_TEXT_SUB} />
                <span style={{ fontSize: 14, fontFamily: "'Noto Sans KR', sans-serif" }}>{label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setIsEn(p => !p)}
            style={{
              flexShrink: 0, padding: "4px 10px", borderRadius: 8,
              border: `1.5px solid ${isEn ? COLOR_PRIMARY : COLOR_BORDER}`,
              background: isEn ? COLOR_PRIMARY : "transparent",
              color: isEn ? "#fff" : COLOR_TEXT_SUB,
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            {isEn ? "한" : "EN"}
          </button>
        </div>

        {/* 탭 별 메인 콘텐츠 영역 */}
        <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          
          {/* 주변 탐색 */}
          {activeTab === "nearby" && (
            <div style={{ padding: "20px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {RADIUS_OPTION_LIST.map((opt, i) => (
                  <button key={opt.label} onClick={() => handleSelectRadius(i)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1.5px solid ${selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_BORDER}`, background: selectedRadiusIdx === i ? COLOR_PRIMARY : COLOR_SURFACE, color: selectedRadiusIdx === i ? "#fff" : COLOR_TEXT_SUB, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {kakaoIsLoading && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 0", color: COLOR_TEXT_SUB }}>
                  <div style={{ width: 28, height: 28, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  <span style={{ fontSize: 13 }}>{isEn ? "Loading nearby places..." : "주변 장소를 불러오는 중..."}</span>
                </div>
              )}
              {!kakaoIsLoading && kakaoError && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 0" }}>
                  <span style={{ fontSize: 28 }}>⚠️</span>
                  <span style={{ fontSize: 13, color: "#e53e3e", textAlign: "center" }}>{kakaoError}</span>
                  <button onClick={kakaoRefetch} style={{ padding: "8px 18px", borderRadius: 10, border: `1.5px solid ${COLOR_PRIMARY}`, background: "transparent", color: COLOR_PRIMARY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>{isEn ? "Retry" : "다시 시도"}</button>
                </div>
              )}
              {!kakaoIsLoading && !kakaoError && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{isEn ? "Nearby" : "주변 장소"} <span style={{ color: COLOR_PRIMARY }}>{kakaoPlaceList.length}</span></span>
                    <span style={{ fontWeight: 400, fontSize: 11 }}>{isEn ? "by distance" : "거리순"}</span>
                    <button onClick={kakaoRefetch} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 0 }}>🔄</button>
                  </div>
                  {kakaoPlaceList.length === 0
                    ? <div style={{ textAlign: "center", color: COLOR_INACTIVE, fontSize: 13, padding: 40 }}>{isEn ? "No places nearby" : "반경 내 장소가 없어요"}</div>
                    : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {kakaoPlaceList.map(place => (
                          <PlaceCard key={place.id} place={place} isSelected={selectedPlace?.id === place.id} onSelect={handleSelectPlace} onDetail={setDetailPlace} isEn={isEn} />
                        ))}
                      </div>
                  }
                </>
              )}
            </div>
          )}

          {/* 경로 탐색 */}
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
              disasterZones={detourDisasterZones}
              disasterDetourActive={showDisasterModal}
              navRoute={navRoute}
              navIsRecommend={navIsRecommend}
              isEn={isEn}
            />
          )}

          {/* 즐겨찾기 */}
          {activeTab === "favorites" && (
            <div style={{ padding: "20px" }}>
              {!googleUser ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "48px 0", color: COLOR_TEXT_SUB }}>
                  <span style={{ fontSize: 36 }}>⭐</span>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN }}>{isEn ? "Favorites" : "즐겨찾기"}</div>
                  <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
                    {isEn ? <>Sign in with Google<br/>to use favorites</> : <>Google 로그인 후<br/>즐겨찾기를 사용할 수 있어요</>}
                  </div>
                  <button
                    onClick={() => handleGoogleLogin()}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, cursor: "pointer", fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, fontFamily: "'Noto Sans KR', sans-serif" }}
                  >
                    <IconGoogle /> {isEn ? "Sign in with Google" : "Google로 로그인"}
                  </button>
                </div>
              ) : favorites.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 0", color: COLOR_TEXT_SUB }}>
                  <span style={{ fontSize: 36 }}>☆</span>
                  <div style={{ fontSize: 13 }}>{isEn ? "No favorite places" : "즐겨찾기한 장소가 없어요"}</div>
                  <div style={{ fontSize: 12 }}>{isEn ? "Tap ★ on a place detail to add" : "장소 상세 화면의 ★ 버튼으로 추가해보세요"}</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_SUB, marginBottom: 12 }}>
                    {isEn ? "Favorites" : "즐겨찾기"} <span style={{ color: COLOR_PRIMARY }}>{favorites.length}{isEn ? "" : "개"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {favorites.map(place => (
                      <PlaceCard
                        key={place.id}
                        place={place}
                        isSelected={selectedPlace?.id === place.id}
                        onSelect={handleSelectPlace}
                        onDetail={setDetailPlace}
                        isEn={isEn}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 도착지 재난구역 경고 모달 */}
        {showDestWarning && pendingNavRoute && pendingNavAlerts.length > 0 && (
          <DestinationWarningModal
            alerts={pendingNavAlerts}
            onConfirm={handleConfirmDestWarning}
            onCancel={handleCancelDestWarning}
            isEn={isEn}
          />
        )}

        {/* 우회 경로 선택 모달 */}
        {showDisasterModal && pendingNavRoute && pendingNavAlerts.length > 0 && (
          <DisasterRouteChoiceModal
            route={pendingNavRoute}
            alerts={pendingNavAlerts}
            detourRoutes={pendingNavCtx?.type === 'manual' ? detourManualRoutes : recRoutes}
            detourLoading={pendingNavCtx?.type === 'manual' ? detourManualLoading : recIsLoading}
            destInZone={detourDestInZone}
            onKeep={handleConfirmNavigation}
            onDetour={handleDetourSearch}
            onSelectDetour={handleSelectDetour}
            onPreviewDetour={handlePreviewDetour}
            isEn={isEn}
            onClose={() => {
              handlePreviewDetour(null);
              setShowDisasterModal(false);
              setPendingNavRoute(null);
              setPendingNavAlerts([]);
              setPendingNavCtx(null);
              setDetourDisasterZones([]);
              setDetourManualRoutes([]);
              setDetourDestInZone(false);
              setDetourCategoryBias(undefined);
            }}
          />
        )}

        {/* 장소 상세 패널 */}
        {detailPlace && (
          <PlaceDetailPanel
            place={detailPlace}
            onClose={() => setDetailPlace(null)}
            isFavorited={isFavorited(detailPlace.id)}
            onToggleFavorite={googleUser ? () => toggleFavorite(detailPlace) : undefined}
            isEn={isEn}
          />
        )}
      </div>

      {/* ── [RIGHT MAP AREA] ───────────────────────────── */}
      <div style={{ flex: 1, position: "relative" }}>
        
        {/* 실제 지도 컨테이너 */}
        <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── 검색창 / 현위치 / 로그인 ── */}
        <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 2000 }}>
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
              placeholder={isEn ? "Search places or addresses" : "장소, 주소를 검색하세요"}
              style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: COLOR_TEXT_MAIN, background: "transparent", fontFamily: "'Noto Sans KR', sans-serif" }}
            />
            {searchQuery.length > 0 && (
              <div onClick={() => { handleClearSearch(); setConfirmedSearchPlace(null); }} style={{ width: 20, height: 20, borderRadius: "50%", background: COLOR_INACTIVE, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#fff", fontWeight: 700 }}>✕</div>
            )}
            <div style={{ width: 1, height: 18, background: COLOR_BORDER, flexShrink: 0 }} />
            <div onClick={() => googleUser ? handleGoogleLogout() : handleGoogleLogin()} style={{ width: 32, height: 32, borderRadius: "50%", background: googleUser ? COLOR_BG : "#fff", border: `1px solid ${COLOR_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, overflow: "hidden" }}>
              {googleUser ? <img src={googleUser.picture} alt={googleUser.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : <IconGoogle />}
            </div>
          </div>

          {/* 장소 키워드 검색 결과 드롭다운 */}
          {showDropdown && searchResults.length > 0 && (
            <div style={{ marginTop: 6, background: "rgba(255,255,255,0.98)", backdropFilter: "blur(10px)", borderRadius: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.14)", overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
              {searchResults.map((result, i) => {
                const isFocused = focusedSearchResult?.id === result.id;
                return (
                  <div key={result.id} onMouseDown={e => { e.preventDefault(); handleSelectSearchResult(result); }} style={{ padding: "10px 14px", borderBottom: i < searchResults.length - 1 ? `1px solid ${COLOR_BORDER}` : "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, background: isFocused ? `${COLOR_PRIMARY}0d` : "transparent", boxShadow: isFocused ? `inset 0 0 0 2px ${COLOR_PRIMARY}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isFocused ? COLOR_PRIMARY : COLOR_TEXT_MAIN }}>{result.place_name}</span>
                      {!!searchRatings[result.id] && <span style={{ fontSize: 11, fontWeight: 700, color: "#f59a00", background: "#fff8ed", borderRadius: 6, padding: "1px 6px", border: "1px solid #f7d48a" }}>⭐ {searchRatings[result.id].toFixed(1)}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{result.road_address_name || result.address_name}</div>
                    {result.category_name && <div style={{ fontSize: 11, color: COLOR_PRIMARY }}>{result.category_name.split(" > ").pop()}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 안내 중 재난 발생 토스트 */}
        {navDisasterToast && (
          <div style={{ position: "absolute", top: 80, left: 16, zIndex: 1990, background: "rgba(30,41,59,0.93)", backdropFilter: "blur(8px)", color: "#fff", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.28)", maxWidth: 260, display: "flex", alignItems: "center", gap: 8, fontFamily: "'Noto Sans KR', sans-serif" }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <span>{navDisasterToast}</span>
          </div>
        )}

        {/* 안내 중 상단 뱃지 */}
        {isNavigating && navRoute && (
          <div style={{ position: "absolute", top: 80, left: "50%", transform: "translateX(-50%)", zIndex: 30, background: COLOR_PRIMARY, color: "#fff", borderRadius: 24, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontFamily: "'Noto Sans KR', sans-serif" }}>
            <span style={{ fontSize: 16 }}>🗺</span>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{isEn ? `${_ROUTE_LABEL_EN[navRoute.label] ?? navRoute.label} Navigation` : `${navRoute.label} 안내 중`}</span>
          </div>
        )}

        {/* 장소 키워드 검색 결과 마커 오버레이 */}
        {searchResults.length > 0
          ? searchResults.map((result) => {
              const place = { ...kakaoResultToPlace(result), rating: searchRatings[result.id] ?? 0 };
              return (
                <PlaceMarker
                  key={result.id} place={place}
                  isSelected={focusedSearchResult?.id === result.id}
                  isActive={true} isDeemphasized={focusedSearchResult?.id !== result.id}
                  kakaoMapRef={kakaoMapRef} onSelectPlace={handleSelectPlaceFromMap}
                />
              );
            })
          : confirmedSearchPlace && (
              <PlaceMarker
                key={confirmedSearchPlace.id} place={confirmedSearchPlace}
                isSelected={true} isActive={true} isDeemphasized={false}
                kakaoMapRef={kakaoMapRef} onSelectPlace={() => setConfirmedSearchPlace(null)}
              />
            )
        }

        {/* 주변 탐색 마커 (NearbyMap) */}
        {activeTab === "nearby" && (
          <NearbyMap
            userLat={userLat} userLng={userLng} isLocating={isLocating} locLabel={locLabel}
            radiusMeter={radiusConfig.meter} selectedPlace={selectedPlace} onSelectPlace={handleSelectPlaceFromMap}
            selectedRadiusIdx={selectedRadiusIdx} onSelectRadius={handleSelectRadius}
            kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} placeList={kakaoPlaceList}
          />
        )}

        {/* 재난 시스템 오버레이 및 배너 */}
        <DisasterZoneOverlay activeAlerts={activeAlerts} kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} />
        <DisasterStatusChip activeAlerts={activeAlerts} alertQueue={alertQueue} isEn={isEn} />
        <DisasterAlertBanner currentAlert={currentAlert} alertQueue={alertQueue} remainingSec={remainingSec} onDismiss={dismissCurrent} kakaoMapRef={kakaoMapRef} />
        
        {/* 현위치 FAB */}
        <div
          onClick={handleMoveToCurrentLoc}
          title={isEn ? "Move to current location" : "현위치로 이동"}
          style={{
            position: "absolute", bottom: 24, right: 20, zIndex: 2000,
            width: 48, height: 48, borderRadius: "50%",
            background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: isLocating ? "default" : "pointer",
            border: `1.5px solid ${isLocating ? COLOR_BORDER : COLOR_USER_PIN}`,
            transition: "box-shadow 0.18s",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isLocating ? COLOR_TEXT_SUB : COLOR_USER_PIN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" strokeOpacity="0.25" />
          </svg>
        </div>

        {/* 도착지 재난구역 경고 모달 */}
        {showDestWarning && pendingNavRoute && pendingNavAlerts.length > 0 && (
          <DestinationWarningModal
            alerts={pendingNavAlerts}
            onConfirm={handleConfirmDestWarning}
            onCancel={handleCancelDestWarning}
          />
        )}

        {/* 우회 경로 선택 모달 */}
        {showDisasterModal && pendingNavRoute && pendingNavAlerts.length > 0 && (
          <DisasterRouteChoiceModal
            route={pendingNavRoute}
            alerts={pendingNavAlerts}
            detourRoutes={pendingNavCtx?.type === 'manual' ? detourManualRoutes : recRoutes}
            detourLoading={pendingNavCtx?.type === 'manual' ? detourManualLoading : recIsLoading}
            destInZone={detourDestInZone}
            onKeep={handleConfirmNavigation}
            onDetour={handleDetourSearch}
            onSelectDetour={handleSelectDetour}
            onPreviewDetour={handlePreviewDetour}
            onClose={() => {
              handlePreviewDetour(null);
              setShowDisasterModal(false);
              setPendingNavRoute(null);
              setPendingNavAlerts([]);
              setPendingNavCtx(null);
              setDetourDisasterZones([]);
              setDetourManualRoutes([]);
              setDetourDestInZone(false);
              setDetourCategoryBias(undefined);
            }}
          />
        )}
      </div>

      {/* ── [RIGHT MAP AREA] ───────────────────────────── */}
      <div style={{ flex: 1, position: "relative" }}>
        
        {/* 실제 지도 컨테이너 */}
        <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── 검색창 / 현위치 / 로그인 ── */}
        <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 2000 }}>
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
                  <div key={result.id} onMouseDown={e => { e.preventDefault(); handleSelectSearchResult(result); }} style={{ padding: "10px 14px", borderBottom: i < searchResults.length - 1 ? `1px solid ${COLOR_BORDER}` : "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, background: isFocused ? `${COLOR_PRIMARY}0d` : "transparent", boxShadow: isFocused ? `inset 0 0 0 2px ${COLOR_PRIMARY}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isFocused ? COLOR_PRIMARY : COLOR_TEXT_MAIN }}>{result.place_name}</span>
                      {!!searchRatings[result.id] && <span style={{ fontSize: 11, fontWeight: 700, color: "#f59a00", background: "#fff8ed", borderRadius: 6, padding: "1px 6px", border: "1px solid #f7d48a" }}>⭐ {searchRatings[result.id].toFixed(1)}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{result.road_address_name || result.address_name}</div>
                    {result.category_name && <div style={{ fontSize: 11, color: COLOR_PRIMARY }}>{result.category_name.split(" > ").pop()}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 안내 중 재난 발생 토스트 */}
        {navDisasterToast && (
          <div style={{ position: "absolute", top: 80, left: 16, zIndex: 1990, background: "rgba(30,41,59,0.93)", backdropFilter: "blur(8px)", color: "#fff", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.28)", maxWidth: 260, display: "flex", alignItems: "center", gap: 8, fontFamily: "'Noto Sans KR', sans-serif" }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <span>{navDisasterToast}</span>
          </div>
        )}

        {/* 안내 중 상단 뱃지 */}
        {isNavigating && navRoute && (
          <div style={{ position: "absolute", top: 80, left: "50%", transform: "translateX(-50%)", zIndex: 30, background: COLOR_PRIMARY, color: "#fff", borderRadius: 24, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontFamily: "'Noto Sans KR', sans-serif" }}>
            <span style={{ fontSize: 16 }}>🗺</span>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{navRoute.label} 안내 중</span>
          </div>
        )}

        {/* 장소 키워드 검색 결과 마커 오버레이 */}
        {searchResults.length > 0
          ? searchResults.map((result) => {
              const place = { ...kakaoResultToPlace(result), rating: searchRatings[result.id] ?? 0 };
              return (
                <PlaceMarker
                  key={result.id} place={place}
                  isSelected={focusedSearchResult?.id === result.id}
                  isActive={true} isDeemphasized={focusedSearchResult?.id !== result.id}
                  kakaoMapRef={kakaoMapRef} onSelectPlace={handleSelectPlace}
                />
              );
            })
          : confirmedSearchPlace && (
              <PlaceMarker
                key={confirmedSearchPlace.id} place={confirmedSearchPlace}
                isSelected={true} isActive={true} isDeemphasized={false}
                kakaoMapRef={kakaoMapRef} onSelectPlace={() => setConfirmedSearchPlace(null)}
              />
            )
        }

        {/* 주변 탐색 마커 (NearbyMap) */}
        {activeTab === "nearby" && (
          <NearbyMap
            userLat={userLat} userLng={userLng} isLocating={isLocating} locLabel={locLabel}
            radiusMeter={radiusConfig.meter} selectedPlace={selectedPlace} onSelectPlace={handleSelectPlace}
            selectedRadiusIdx={selectedRadiusIdx} onSelectRadius={handleSelectRadius}
            kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} placeList={kakaoPlaceList}
          />
        )}

        {/* 재난 시스템 오버레이 및 배너 */}
        <DisasterZoneOverlay activeAlerts={activeAlerts} kakaoMapRef={kakaoMapRef} isMapReady={isMapReady} />
        <DisasterStatusChip activeAlerts={activeAlerts} alertQueue={alertQueue} />
        <DisasterAlertBanner currentAlert={currentAlert} alertQueue={alertQueue} remainingSec={remainingSec} onDismiss={dismissCurrent} kakaoMapRef={kakaoMapRef} />
        
        {/* 모달은 여기서 완전히 제거되었습니다! */}
      </div>
    </div>
  );
};

export default RouteScreen;