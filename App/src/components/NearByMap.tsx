// ═══════════════════════════════════════════════════════════
// NearByMap — 주변 장소 지도 오버레이 컴포넌트
//
// [구조]
//   - 사용자 위치 기준 반경 원(Circle) 오버레이 렌더링
//   - 현재 위치 라벨 뱃지 (지도 상단 중앙 고정)
//   - placeList의 각 장소를 PlaceMarker로 렌더링
//
// [마커 상태 결정]
//   isActive       — 반경(radiusMeter) 이내 장소
//   isSelected     — 현재 선택된 장소
//   isDeemphasized — 다른 장소 선택 시 나머지 마커 반투명 처리
//
// [Props]
//   userLat/userLng — 사용자 현재 위치
//   radiusMeter     — 탐색 반경 (원 크기 + 활성 마커 기준)
//   selectedPlace   — 현재 선택된 장소
//   kakaoMapRef     — 카카오 지도 인스턴스 ref
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useRef } from "react";
import type { Place } from "../types/type";
import { COLOR_TEXT_SUB } from "../colors";
import type { KakaoCircle, KakaoMapInstance } from "../types/type_kakao";
import PlaceMarker from "./PlaceMarker";

const COLOR_PIN = "#3B7DFF";

interface NearbyMapProps {
  userLat:           number;
  userLng:           number;
  isLocating:        boolean;
  locLabel:          string;
  radiusMeter:       number;
  selectedPlace:     Place | null;
  onSelectPlace:     (place: Place | null) => void;
  onDetailPlace?:    (place: Place) => void;
  selectedRadiusIdx: number;
  onSelectRadius:    (idx: number) => void;
  kakaoMapRef:       React.MutableRefObject<KakaoMapInstance | null>;
  isMapReady:        boolean;
  placeList:         Place[];
}

const NearbyMap: FC<NearbyMapProps> = ({
  userLat, userLng, locLabel,
  radiusMeter, selectedPlace, onSelectPlace, onDetailPlace,
  kakaoMapRef, isMapReady,
  placeList,
}) => {
  const circleRef = useRef<KakaoCircle | null>(null);

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

  const hasSelection = selectedPlace !== null;

  return (
    <>
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

      {isMapReady && placeList.map(place => {
        const isActive       = place.distance <= radiusMeter;
        const isSelected     = selectedPlace?.id === place.id;
        const isDeemphasized = hasSelection && !isSelected && isActive;
        return (
          <PlaceMarker
            key={place.id}
            place={place}
            isSelected={isSelected}
            isActive={isActive}
            isDeemphasized={isDeemphasized}
            kakaoMapRef={kakaoMapRef}
            onSelectPlace={onSelectPlace}
            onDetailPlace={onDetailPlace}
          />
        );
      })}
    </>
  );
};

export default NearbyMap;
