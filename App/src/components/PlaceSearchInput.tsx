// ═══════════════════════════════════════════════════════════
// PlaceSearchInput — 카카오 장소 검색 입력 컴포넌트
//
// [구조]
//   - 텍스트 입력 → 카카오 장소 검색 API 호출
//   - 검색 결과 드롭다운 표시 (포커스 강조 포함)
//   - 결과 선택 시 onConfirm 콜백 호출
//
// [지도 연동]
//   - kakaoMapRef 전달 시 검색 결과 핀 오버레이 렌더링
//   - focusedResult 강조 핀 + 일반 결과 반투명 핀 표시
//   - confirmedPin: 검색 외부에서 직접 지정된 핀 (현재 위치 등)
//
// [Props]
//   externalValue  — 외부에서 입력값 주입 (swap, 현재위치 버튼)
//   onConfirm      — 장소 선택 확정 콜백
//   onFocusResult  — 드롭다운 항목 포커스 시 콜백
//   getDisplayValue — 선택 후 입력창에 표시할 문자열 커스터마이징
//   rightSlot      — 입력 우측 슬롯 (버튼 등)
// ═══════════════════════════════════════════════════════════

import { type FC, type CSSProperties, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { usePlaceSearch } from "../hooks/UsePlaceSearch";
import type { KakaoPlaceSearchResult, KakaoMapInstance, KakaoOverlay } from "../types/type_kakao";
import { COLOR_BORDER, COLOR_PRIMARY, COLOR_TEXT_MAIN, COLOR_TEXT_SUB } from "../colors";
import type { Place } from "../types/type";
import PlaceMarker from "./PlaceMarker";

interface PlaceSearchInputProps {
  externalValue?:   string;
  onConfirm:        (result: KakaoPlaceSearchResult) => void;
  onFocusResult?:   (result: KakaoPlaceSearchResult) => void;
  getDisplayValue?: (result: KakaoPlaceSearchResult) => string;
  isServicesReady:  boolean;
  placeholder:      string;
  dotStyle?:        CSSProperties;
  rightSlot?:       React.ReactNode;
  rowStyle?:        CSSProperties;
  kakaoMapRef?:     { current: KakaoMapInstance | null };
  markerColor?:     string;
  confirmedPin?:    { lat: number; lng: number; label: string } | null;
}

// 핀 오버레이 생성
const createPinOverlay = (
  result:   KakaoPlaceSearchResult,
  color:    string,
  selected: boolean,
  map:      KakaoMapInstance,
  onClick:  () => void,
): KakaoOverlay => {
  const size    = selected ? 36 : 28;
  const opacity = selected ? 1 : 0.5;
  const el      = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer;";
  el.innerHTML = `
    ${selected ? `
      <div style="background:#fff;border-radius:8px;padding:3px 9px;margin-bottom:4px;white-space:nowrap;
        box-shadow:0 2px 10px rgba(0,0,0,0.15);font-size:11px;font-weight:700;color:#111;
        border:1.5px solid ${color};font-family:'Noto Sans KR',sans-serif;">
        ${result.place_name}
      </div>` : ""}
    <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2.5px solid #fff;opacity:${opacity};
      box-shadow:${selected ? `0 4px 14px ${color}66` : "0 2px 8px rgba(0,0,0,0.2)"};
      transition:all 0.2s;"></div>`;
  el.addEventListener("click", onClick);
  return new window.kakao.maps.CustomOverlay({
    map,
    position: new window.kakao.maps.LatLng(parseFloat(result.y), parseFloat(result.x)),
    content:  el,
    yAnchor:  selected ? 1.3 : 1.1,
    zIndex:   selected ? 10 : 5,
  });
};

const PlaceSearchInput: FC<PlaceSearchInputProps> = ({
  externalValue,
  onConfirm, onFocusResult, getDisplayValue,
  isServicesReady,
  placeholder,
  dotStyle,
  rightSlot,
  rowStyle,
  kakaoMapRef,
  markerColor = "#3B7DFF",
  confirmedPin,
}) => {
  const [confirmedResult, setConfirmedResult] = useState<KakaoPlaceSearchResult | null>(null);
  const overlaysRef            = useRef<KakaoOverlay[]>([]);
  const confirmedPinOverlayRef = useRef<KakaoOverlay | null>(null);
  // confirm 직후 externalValue 변경 시 마커를 지우지 않도록 보호
  const skipClearRef = useRef(false);

  const wrappedOnConfirm = useCallback((result: KakaoPlaceSearchResult) => {
    skipClearRef.current = true;
    setConfirmedResult(result);
    onConfirm(result);
  }, [onConfirm]);

  const {
    query, setQuery, overrideQuery,
    results, showDropdown, setShowDropdown,
    focusedResult, handleSelect, handleClear,
  } = usePlaceSearch({ isServicesReady, onConfirm: wrappedOnConfirm, onFocusResult, getDisplayValue });

  // 외부에서 값 주입 (swap, 현재위치 버튼 등)
  useEffect(() => {
    if (externalValue !== undefined) {
      overrideQuery(externalValue);
      if (skipClearRef.current) {
        skipClearRef.current = false;
      } else {
        setConfirmedResult(null);
      }
    }
  }, [externalValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // 검색 결과 마커 (결과 목록 전체, focusedResult 강조)
  useEffect(() => {
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];
    if (!kakaoMapRef?.current || results.length === 0) return;

    results.forEach(result => {
      const isSelected = focusedResult?.id === result.id;
      const overlay = createPinOverlay(result, markerColor, isSelected, kakaoMapRef.current!, () =>
        handleSelect(result),
      );
      overlaysRef.current.push(overlay);
    });

    return () => {
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
    };
  }, [results, focusedResult, kakaoMapRef, markerColor, handleSelect]);

  // 외부에서 직접 지정된 핀 (현재 위치 등 검색 없이 설정된 경우)
  useEffect(() => {
    confirmedPinOverlayRef.current?.setMap(null);
    confirmedPinOverlayRef.current = null;
    if (!kakaoMapRef?.current || !confirmedPin || results.length > 0) return;

    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
    el.innerHTML = `
      <div style="background:#fff;border-radius:8px;padding:3px 9px;margin-bottom:4px;white-space:nowrap;
        box-shadow:0 2px 10px rgba(0,0,0,0.15);font-size:11px;font-weight:700;color:#111;
        border:1.5px solid ${markerColor};font-family:'Noto Sans KR',sans-serif;">
        ${confirmedPin.label}
      </div>
      <div style="width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        background:${markerColor};border:2.5px solid #fff;
        box-shadow:0 4px 14px ${markerColor}66;transition:all 0.2s;"></div>`;

    confirmedPinOverlayRef.current = new window.kakao.maps.CustomOverlay({
      map:      kakaoMapRef.current!,
      position: new window.kakao.maps.LatLng(confirmedPin.lat, confirmedPin.lng),
      content:  el,
      yAnchor:  1.3,
      zIndex:   10,
    });

    return () => {
      confirmedPinOverlayRef.current?.setMap(null);
      confirmedPinOverlayRef.current = null;
    };
  }, [confirmedPin, results.length, kakaoMapRef, markerColor]);

  const handleClearWithMarker = useCallback(() => {
    setConfirmedResult(null);
    handleClear();
  }, [handleClear]);

  const confirmedPlace = useMemo<Place | null>(() => {
    if (!confirmedResult) return null;
    return {
      id:       parseInt(confirmedResult.id, 10),
      name:     confirmedResult.place_name,
      category: "명소",
      rating:   0,
      reviews:  0,
      district: confirmedResult.address_name.split(" ").slice(0, 2).join(" "),
      lat:      parseFloat(confirmedResult.y),
      lng:      parseFloat(confirmedResult.x),
      distance: 0,
    };
  }, [confirmedResult]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, ...rowStyle }}>
        {dotStyle && <div style={{ width: 10, height: 10, flexShrink: 0, ...dotStyle }} />}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder={placeholder}
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, color: COLOR_TEXT_MAIN, background: "transparent", fontFamily: "'Noto Sans KR', sans-serif" }}
        />
        {query.length > 0 && (
          <div
            onMouseDown={e => { e.preventDefault(); handleClearWithMarker(); }}
            style={{ width: 18, height: 18, borderRadius: "50%", background: "#ccc", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0 }}
          >✕</div>
        )}
        {rightSlot}
      </div>

      {showDropdown && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
          marginTop: 4, background: "rgba(255,255,255,0.98)",
          backdropFilter: "blur(10px)", borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
          overflow: "hidden", maxHeight: 240, overflowY: "auto",
        }}>
          {results.map((result, i) => {
            const isFocused = focusedResult?.id === result.id;
            return (
              <div
                key={result.id}
                onMouseDown={e => { e.preventDefault(); handleSelect(result); }}
                style={{
                  padding: "9px 14px",
                  borderBottom: i < results.length - 1 ? `1px solid ${COLOR_BORDER}` : "none",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 2,
                  background: isFocused ? `${COLOR_PRIMARY}0d` : "transparent",
                  boxShadow: isFocused ? `inset 0 0 0 2px ${COLOR_PRIMARY}` : "none",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: isFocused ? COLOR_PRIMARY : COLOR_TEXT_MAIN }}>{result.place_name}</div>
                <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{result.road_address_name || result.address_name}</div>
                {result.category_name && (
                  <div style={{ fontSize: 11, color: COLOR_PRIMARY }}>{result.category_name.split(" > ").pop()}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {kakaoMapRef && confirmedPlace && results.length === 0 && (
        <PlaceMarker
          key={confirmedResult?.id}
          place={confirmedPlace}
          isSelected={true}
          isActive={true}
          isDeemphasized={false}
          kakaoMapRef={kakaoMapRef}
          onSelectPlace={handleClearWithMarker}
          pinColor={markerColor}
          hideCategoryIcon={true}
        />
      )}
    </div>
  );
};

export default PlaceSearchInput;
