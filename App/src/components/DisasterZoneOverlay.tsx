// ═══════════════════════════════════════════════════════════
// DisasterZoneOverlay — 재난 위험구역 지도 오버레이 헤드리스 컴포넌트
//
// [구조]
//   - DOM 노드 반환 없이 카카오 지도 오버레이만 제어
//   - 재난별 빨간 원(반경) + 경고 마커 핀 렌더링
//   - activeAlerts 변경 시 기존 오버레이 제거 후 재렌더링
//
// [마커 표시]
//   - 원: 재난 반경(radius_m) 크기로 반투명 빨간 원
//   - 핀: 재난 유형 이모지 + 요약 말풍선
//
// [Props]
//   activeAlerts — 현재 활성 재난 목록
//   kakaoMapRef  — 카카오 지도 인스턴스 ref
//   isMapReady   — 지도 초기화 완료 여부
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useRef } from "react";
import type { DisasterAlert, DisasterType } from "../hooks/UseDisasterAlert";
import type { KakaoCircle, KakaoMapInstance, KakaoOverlay } from "../types/type_kakao";

// ── [CONFIG] 재난 유형별 색상 ─────────────────────────────

const DST_COLOR: Record<DisasterType, { stroke: string; fill: string }> = {
  호우:     { stroke: "#2563EB", fill: "#3B82F6" },
  교통통제: { stroke: "#EA580C", fill: "#F59A00" },
  긴급재난: { stroke: "#DC2626", fill: "#EF4444" },
};

const DST_ICON: Record<DisasterType, string> = {
  호우:     "🌧️",
  교통통제: "🚧",
  긴급재난: "🚨",
};

// [CONFIG] 재난 유형별 기본 반경 (radius_m 없을 때 fallback)
// [API] 실제 연동 시 disaster_center.radius_m 값 사용
const DEFAULT_RADIUS: Record<DisasterType, number> = {
  긴급재난: 300,
  교통통제: 500,
  호우:     800,
};

// ── [TYPE] ────────────────────────────────────────────────

interface DisasterZoneOverlayProps {
  activeAlerts: DisasterAlert[];
  kakaoMapRef:  React.MutableRefObject<KakaoMapInstance | null>;
  isMapReady:   boolean;
}

// ── [COMPONENT] ───────────────────────────────────────────

const DisasterZoneOverlay: FC<DisasterZoneOverlayProps> = ({
  activeAlerts, kakaoMapRef, isMapReady,
}) => {
  const circleListRef  = useRef<KakaoCircle[]>([]);
  const overlayListRef = useRef<KakaoOverlay[]>([]);

  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return;

    // [LOGIC] 기존 레이어 정리
    circleListRef.current.forEach(c => c.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    circleListRef.current  = [];
    overlayListRef.current = [];

    activeAlerts.forEach(alert => {
      // [API] 실제 연동 시: alert.disasterCenter.lat / lng / radius_m 사용
      // [CONFIG] Mock: rcptnRgnNm 기반 임시 좌표 (서울 중심 근처)
      const lat    = alert.lat    ?? 37.5665;
      const lng    = alert.lng    ?? 126.9780;
      const radius = alert.radiusM ?? DEFAULT_RADIUS[alert.dstSeNm];
      const color  = DST_COLOR[alert.dstSeNm];

      const center = new window.kakao.maps.LatLng(lat, lng);

      // [UI] 위험구역 원
      const circle = new window.kakao.maps.Circle({
        map:           kakaoMapRef.current!,
        center,
        radius,
        strokeWeight:  2,
        strokeColor:   color.stroke,
        strokeOpacity: 0.8,
        strokeStyle:   "solid",
        fillColor:     color.fill,
        fillOpacity:   0.12,
      });
      circleListRef.current.push(circle);

      // [UI] 경고 마커 핀
      const el = document.createElement("div");
      el.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer;";
      el.innerHTML = `
        <div style="
          background:#fff;border-radius:8px;padding:3px 10px;margin-bottom:4px;
          white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.15);
          font-size:11px;font-weight:700;color:#1A1D23;
          border:1.5px solid ${color.stroke};font-family:'Noto Sans KR',sans-serif;
          max-width:160px;overflow:hidden;text-overflow:ellipsis;
        ">
          ${DST_ICON[alert.dstSeNm]} ${alert.summary}
        </div>
        <div style="
          width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
          background:${color.fill};border:2.5px solid #fff;
          box-shadow:0 2px 8px rgba(0,0,0,0.2);
          display:flex;align-items:center;justify-content:center;
        ">
          <span style="transform:rotate(45deg);font-size:13px;">
            ${DST_ICON[alert.dstSeNm]}
          </span>
        </div>`;

      const overlay = new window.kakao.maps.CustomOverlay({
        map:      kakaoMapRef.current!,
        position: center,
        content:  el,
        yAnchor:  1.1,
        zIndex:   30,
      });
      overlayListRef.current.push(overlay);
    });

    return () => {
      circleListRef.current.forEach(c => c.setMap(null));
      overlayListRef.current.forEach(o => o.setMap(null));
      circleListRef.current  = [];
      overlayListRef.current = [];
    };
  }, [isMapReady, activeAlerts, kakaoMapRef]);

  return null;
};

export default DisasterZoneOverlay;