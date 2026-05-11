// ═══════════════════════════════════════════════════════════
// NearByMap — 근처 탐색 지도 컴포넌트 (카카오맵 API 활용)
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useRef } from "react";
import type { Place, PlaceData, Category } from "../types/type";
import { COLOR_INACTIVE, COLOR_TEXT_MAIN, COLOR_TEXT_SUB } from "../colors";
import type { KakaoCircle, KakaoMapInstance, KakaoMarker, KakaoOverlay } from "../types/type_kakao";
import { toPlace } from "../utils/Utils";

// [CONFIG] 반경 옵션
const RADIUS_OPTION_LIST = [
  { label: "가까운 곳", meter: 250 },
  { label: "기본",      meter: 500 },
  { label: "넓은 곳",   meter: 1000 },
] as const;

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍",
};

// [THEME] 지도 핀 파란색
const COLOR_PIN        = "#3B7DFF";
const COLOR_PIN_ACTIVE = "#2563EB";
const COLOR_PIN_RING   = "rgba(59,125,255,0.18)";

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

interface NearbyMapProps {
  userLat:           number;
  userLng:           number;
  isLocating:        boolean;
  locLabel:          string;
  radiusMeter:       number;
  selectedPlace:     Place | null;
  onSelectPlace:     (place: Place | null) => void;
  selectedRadiusIdx: number;
  onSelectRadius:    (idx: number) => void;
  kakaoMapRef:       React.MutableRefObject<KakaoMapInstance | null>;
  isMapReady:        boolean;
}

const NearbyMap: FC<NearbyMapProps> = ({
  userLat, userLng, isLocating, locLabel,
  radiusMeter, selectedPlace, onSelectPlace,
  kakaoMapRef, isMapReady,
}) => {
  const circleRef      = useRef<KakaoCircle | null>(null);
  const overlayListRef = useRef<KakaoOverlay[]>([]);
  const markerListRef  = useRef<KakaoMarker[]>([]);

  // [NOTE] 현위치 마커는 RouteScreen에서 관리 (탭 무관하게 항상 표시)

  // [SYNC] 반경 원 업데이트
  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return;
    circleRef.current?.setMap(null);
    circleRef.current = new window.kakao.maps.Circle({
      map:           kakaoMapRef.current,
      center:        new window.kakao.maps.LatLng(userLat, userLng),
      radius:        radiusMeter,
      strokeWeight:  2,
      strokeColor:   COLOR_PIN,
      strokeOpacity: 0.7,
      strokeStyle:   "dashed",
      fillColor:     COLOR_PIN,
      fillOpacity:   0.05,
    });
    return () => { circleRef.current?.setMap(null); };
  }, [isMapReady, radiusMeter, userLat, userLng, kakaoMapRef]);

  // [SYNC] 장소 마커 업데이트
  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return;
    overlayListRef.current.forEach(o => o.setMap(null));
    markerListRef.current.forEach(m => m.setMap(null));
    overlayListRef.current = [];
    markerListRef.current  = [];

    const hasSelection = selectedPlace !== null;

    PLACE_LIST.map(p => toPlace(p, userLat, userLng)).forEach(place => {
      const isActive       = place.distance <= radiusMeter;
      const isSelected     = selectedPlace?.id === place.id;
      const isDeemphasized = hasSelection && !isSelected && isActive;

      const pinColor = isSelected && isActive ? COLOR_PIN_ACTIVE : isActive ? COLOR_PIN : COLOR_INACTIVE;
      const size     = isSelected && isActive ? 42 : 34;
      const opacity  = isActive ? (isDeemphasized ? 0.4 : 1) : 0.3;
      const pos      = new window.kakao.maps.LatLng(place.lat, place.lng);

      const el = document.createElement("div");
      el.style.cssText = `display:flex;flex-direction:column;align-items:center;cursor:${isActive ? "pointer" : "default"};opacity:${opacity};filter:${isActive ? "none" : "grayscale(100%)"};transition:all 0.25s;`;
      el.innerHTML = `
        ${isSelected && isActive ? `
          <div style="background:#fff;border-radius:10px;padding:5px 10px;margin-bottom:5px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.14);font-size:12px;font-weight:700;color:${COLOR_TEXT_MAIN};border:2px solid ${COLOR_PIN};position:relative;font-family:'Noto Sans KR',sans-serif;">
            ${place.name} ⭐${place.rating}
            <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${COLOR_PIN};"></div>
          </div>` : ""}
        <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${pinColor};border:2.5px solid #fff;box-shadow:${isSelected ? "0 4px 14px rgba(59,125,255,0.45)" : "0 2px 8px rgba(0,0,0,0.18)"};transition:all 0.25s;"></div>
        <div style="margin-top:3px;font-size:10px;font-weight:${isSelected ? 800 : 600};color:${isActive ? COLOR_TEXT_MAIN : COLOR_INACTIVE};white-space:nowrap;text-shadow:0 1px 3px rgba(255,255,255,0.9);font-family:'Noto Sans KR',sans-serif;transition:all 0.25s;">${place.name}</div>`;

      const overlay = new window.kakao.maps.CustomOverlay({
        map: kakaoMapRef.current!, position: pos, content: el,
        yAnchor: 1.15, zIndex: isSelected ? 10 : 5,
      });
      overlayListRef.current.push(overlay);

      if (isActive) {
        const invisImg    = new window.kakao.maps.MarkerImage("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", new window.kakao.maps.Size(44, 54));
        const invisMarker = new window.kakao.maps.Marker({ position: pos, image: invisImg });
        invisMarker.setMap(kakaoMapRef.current!);
        markerListRef.current.push(invisMarker);
        window.kakao.maps.event.addListener(invisMarker, "click", () => {
          onSelectPlace(selectedPlace?.id === place.id ? null : place);
        });
      }
    });
    return () => {
      overlayListRef.current.forEach(o => o.setMap(null));
      markerListRef.current.forEach(m => m.setMap(null));
      overlayListRef.current = [];
      markerListRef.current  = [];
    };
  }, [isMapReady, radiusMeter, selectedPlace, userLat, userLng, onSelectPlace, kakaoMapRef]);

  // [NOTE] 반경 버튼은 바텀 시트 패널로 이동
  return (
    <div style={{
      position: "absolute", top: 80, left: "50%", transform: "translateX(-50%)",
      background: "rgba(255,255,255,0.88)", backdropFilter: "blur(8px)",
      borderRadius: 20, padding: "4px 14px",
      fontSize: 12, fontWeight: 600, color: COLOR_TEXT_SUB,
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      whiteSpace: "nowrap", zIndex: 10,
      fontFamily: "'Noto Sans KR', sans-serif",
    }}>
      {locLabel}
    </div>
  );
};

export default NearbyMap;