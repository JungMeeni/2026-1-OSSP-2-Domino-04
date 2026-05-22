// ═══════════════════════════════════════════════════════════
// PlaceMarker — 카카오 지도 위 장소 핀 오버레이 컴포넌트
//
// [구조]
//   - CustomOverlay로 핀 + 말풍선 UI 직접 렌더링
//   - 투명 Marker를 핀 위에 겹쳐 클릭 이벤트 처리
//
// [상태별 표시]
//   isSelected     — 핀 확대 + 말풍선(장소명·평점) 표시
//   isActive       — 반경 내 장소 (컬러 핀)
//   isDeemphasized — 다른 장소 선택 시 반투명 처리
//
// [평점 lazy fetch]
//   선택 시 TripAdvisor API로 평점 비동기 조회
//   조회 중: "···" 표시 / 평점 없음: 숨김
//
// [Props]
//   pinColor         — 핀 색상 커스터마이징 (기본: #3B7DFF)
//   hideCategoryIcon — 말풍선 카테고리 아이콘 숨김 여부
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useRef, useState } from "react";
import type { Place, Category } from "../types/type";
import { COLOR_INACTIVE, COLOR_TEXT_MAIN } from "../colors";
import type { KakaoMapInstance, KakaoMarker, KakaoOverlay } from "../types/type_kakao";
import { fetchTaDetail, fetchTaLocationId } from "../hooks/Usekakaonearby";

const COLOR_PIN        = "#3B7DFF";
const COLOR_PIN_ACTIVE = "#2563EB";

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍",
};

interface PlaceMarkerProps {
  place:          Place;
  isSelected:     boolean;
  isActive:       boolean;
  isDeemphasized: boolean;
  kakaoMapRef:    React.MutableRefObject<KakaoMapInstance | null>;
  onSelectPlace:  (place: Place | null) => void;
  pinColor?:      string;
  hideCategoryIcon?: boolean;
}

const PlaceMarker: FC<PlaceMarkerProps> = ({
  place, isSelected, isActive, isDeemphasized,
  kakaoMapRef, onSelectPlace, pinColor, hideCategoryIcon = false,
}) => {
  const overlayRef = useRef<KakaoOverlay | null>(null);
  const markerRef  = useRef<KakaoMarker  | null>(null);

  // null = 로딩 중, 0 = 평점 없음, >0 = 실제 평점
  const [displayRating, setDisplayRating] = useState<number | null>(
    place.rating > 0 ? place.rating : null,
  );

  // place가 바뀌면 평점 초기화
  useEffect(() => {
    setDisplayRating(place.rating > 0 ? place.rating : null);
  }, [place.id, place.rating]);

  // 선택될 때 평점 lazy fetch
  useEffect(() => {
    if (!isSelected) return;
    if (place.rating > 0) { setDisplayRating(place.rating); return; }

    let cancelled = false;
    setDisplayRating(null);
    (async () => {
      const locationId = await fetchTaLocationId(place.name, place.lat, place.lng);
      if (cancelled || !locationId) { setDisplayRating(0); return; }
      const detail = await fetchTaDetail(locationId);
      if (cancelled) return;
      setDisplayRating(detail?.rating ?? 0);
    })();

    return () => { cancelled = true; };
  }, [isSelected, place.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 오버레이 생성/갱신
  useEffect(() => {
    if (!kakaoMapRef.current) return;

    const resolvedPinColor = pinColor
      ? (isActive ? pinColor : COLOR_INACTIVE)
      : isSelected && isActive ? COLOR_PIN_ACTIVE : isActive ? COLOR_PIN : COLOR_INACTIVE;
    const size         = isSelected && isActive ? 42 : 34;
    const opacity      = isActive ? (isDeemphasized ? 0.4 : 1) : 0.3;
    const pos          = new window.kakao.maps.LatLng(place.lat, place.lng);
    const categoryIcon = CATEGORY_ICON[place.category] ?? "📍";

    const ratingText =
      displayRating === null  ? " ···" :
      displayRating > 0       ? ` ⭐${displayRating.toFixed(1)}` :
      "";

    const el = document.createElement("div");
    el.style.cssText = `display:flex;flex-direction:column;align-items:center;cursor:${isActive ? "pointer" : "default"};opacity:${opacity};filter:${isActive ? "none" : "grayscale(100%)"};transition:all 0.25s;`;
    el.innerHTML = `
      ${isSelected && isActive ? `
        <div style="background:#fff;border-radius:10px;padding:5px 10px;margin-bottom:5px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.14);font-size:12px;font-weight:700;color:${COLOR_TEXT_MAIN};border:2px solid ${resolvedPinColor};position:relative;font-family:'Noto Sans KR',sans-serif;">
          ${hideCategoryIcon ? "" : categoryIcon + " "}${place.name}${ratingText}
          <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${resolvedPinColor};"></div>
        </div>` : ""}
      <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${resolvedPinColor};border:2.5px solid #fff;box-shadow:${isSelected ? "0 4px 14px rgba(59,125,255,0.45)" : "0 2px 8px rgba(0,0,0,0.18)"};transition:all 0.25s;"></div>
      <div style="margin-top:3px;font-size:10px;font-weight:${isSelected ? 800 : 600};color:${isActive ? COLOR_TEXT_MAIN : COLOR_INACTIVE};white-space:nowrap;text-shadow:0 1px 3px rgba(255,255,255,0.9);font-family:'Noto Sans KR',sans-serif;transition:all 0.25s;">${place.name}</div>`;

    overlayRef.current?.setMap(null);
    overlayRef.current = new window.kakao.maps.CustomOverlay({
      map:      kakaoMapRef.current,
      position: pos,
      content:  el,
      yAnchor:  1.15,
      zIndex:   isSelected ? 10 : 5,
    });

    markerRef.current?.setMap(null);
    markerRef.current = null;

    if (isActive) {
      const invisImg = new window.kakao.maps.MarkerImage(
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        new window.kakao.maps.Size(44, 54),
      );
      markerRef.current = new window.kakao.maps.Marker({ position: pos, image: invisImg });
      markerRef.current.setMap(kakaoMapRef.current);
      window.kakao.maps.event.addListener(markerRef.current, "click", () => {
        onSelectPlace(isSelected ? null : place);
      });
    }

    return () => {
      overlayRef.current?.setMap(null);
      markerRef.current?.setMap(null);
    };
  }, [place, isSelected, isActive, isDeemphasized, kakaoMapRef, onSelectPlace, displayRating, pinColor, hideCategoryIcon]);

  return null;
};

export default PlaceMarker;
