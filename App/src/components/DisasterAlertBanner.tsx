// ═══════════════════════════════════════════════════════════
// DisasterAlertBanner v2 — 재난 알림 배너 + 이중 경로 선택
//
// [구조]
//   - 하단 슬라이드업 배너 (지도 위 고정)
//   - 배너 탭 or "경로 선택" 버튼 -> RouteChoiceSheet 팝업
//   - RouteChoiceSheet: 기존/우회 경로 비교 카드 + 선택
//   - 선택 완료 시 토스트 피드백
//   - 긴급재난 수신 시 시트 자동 오픈
//   - 배너 하단 타임아웃 프로그레스 바
//
// [이중 경로 렌더링]
//   - kakaoMapRef 전달 시 기존 경로(회색) + 우회 경로(컬러) 동시 표시
//   - [TODO] 실제 우회 경로 폴리라인: /api/directions 응답 연결 후 적용
//   - 현재: Mock 우회 경로 오프셋으로 시각적 시연
//
// [Props]
//   currentAlert   — 현재 표시할 알림 (null이면 렌더 안 함)
//   alertQueue     — 전체 알림 큐 (카운터 표시용)
//   remainingSec   — 타임아웃 남은 초 (프로그레스 바용)
//   onDismiss      — 현재 알림 해제 콜백
//   onSelectRoute  — 경로 선택 콜백 (isDetour: true=우회, false=유지)
//   kakaoMapRef    — 카카오 지도 인스턴스 ref (이중 경로 렌더링용)
// ═══════════════════════════════════════════════════════════

import { type FC, useState, useEffect, useRef, useCallback } from "react";
import type { DisasterAlert, DisasterType } from "../hooks/UseDisasterAlert";
import type { KakaoMapInstance, KakaoOverlay, KakaoPolyline } from "../types/type_kakao";
import {
  COLOR_PRIMARY, COLOR_PRIMARY_LIGHT,
  COLOR_SURFACE, COLOR_BORDER,
  COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_DANGER, COLOR_BG, COLOR_INACTIVE,
  TRAFFIC_COLOR_MAP,
} from "../colors";

// ── [CONFIG] 재난 유형별 색상 ─────────────────────────────

const DST_COLOR: Record<DisasterType, { main: string; light: string; border: string }> = {
  호우:     { main: "#2563EB", light: "#EFF6FF", border: "#BFDBFE" },
  교통통제: { main: COLOR_PRIMARY, light: COLOR_PRIMARY_LIGHT, border: "#FDD99A" },
  긴급재난: { main: COLOR_DANGER,  light: "#FFF1F2",           border: "#FECDD3" },
};

const DST_ICON: Record<DisasterType, string> = {
  호우:     "🌧️",
  교통통제: "🚧",
  긴급재난: "🚨",
};

const TIMEOUT_TOTAL_SEC: Record<DisasterType, number> = {
  긴급재난: 30 * 60,
  교통통제:  2 * 60 * 60,
  호우:      6 * 60 * 60,
};

// ── [CONFIG] Mock 경로 비교 데이터
// [TODO] /api/directions 응답의 disaster_analysis 연결 후 교체
const MOCK_ROUTE_INFO = {
  current: { distanceM: 4200, durationSec: 1080, label: "현재 경로" },
  detour:  { distanceM: 5800, durationSec: 1380, label: "우회 경로" },
};

// ── [TYPE] ────────────────────────────────────────────────

interface DisasterAlertBannerProps {
  currentAlert:  DisasterAlert | null;
  alertQueue:    DisasterAlert[];
  remainingSec:  number;
  onDismiss:     () => void;
  onSelectRoute: (isDetour: boolean) => void;
  kakaoMapRef?:  React.MutableRefObject<KakaoMapInstance | null>;
  // [NAV] 안내 중 여부 — true면 재난 감지 시 경로 변경 카드 표시
  isNavigating?: boolean;
}

interface RouteChoiceSheetProps {
  alert:         DisasterAlert;
  onClose:       () => void;
  onSelectRoute: (isDetour: boolean) => void;
  kakaoMapRef?:  React.MutableRefObject<KakaoMapInstance | null>;
}

// ── [UTIL] 시간/거리 포맷 ─────────────────────────────────

const fmt = {
  duration: (sec: number) => {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  },
  distance: (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`,
};

// ── [SUB] NavigationDisasterCard — 안내 중 재난 감지 카드 ──
// [구조]
//   - 안내 중에 재난 알림이 오면 배너 대신 이 카드 표시
//   - 원래 경로 유지 / 경로 변경 두 가지 선택
//   - 두 경로 차이(시간/거리) 비교 표시
// [TODO] 실제 우회 경로 데이터: /api/directions 연결 후 교체

interface NavigationDisasterCardProps {
  alert:     DisasterAlert;
  onKeep:    () => void;
  onDetour:  () => void;
  onDismiss: () => void;
}

const NavigationDisasterCard: FC<NavigationDisasterCardProps> = ({
  alert, onKeep, onDetour, onDismiss,
}) => {
  const color = DST_COLOR[alert.dstSeNm];

  return (
    <div style={{
      position:   "fixed",
      bottom:     90,
      left:       16,
      right:      16,
      zIndex:     900,
      background: COLOR_SURFACE,
      borderRadius: 16,
      border:     `1.5px solid ${color.border}`,
      boxShadow:  "0 8px 32px rgba(0,0,0,0.16)",
      overflow:   "hidden",
      animation:  "slideUpBanner 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
    }}>
      {/* 상단 헤더 */}
      <div style={{ padding: "12px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: color.main, color: "#fff",
            fontSize: 10, fontWeight: 700,
            padding: "2px 8px", borderRadius: 20,
          }}>
            <span>{DST_ICON[alert.dstSeNm]}</span>
            <span>{alert.dstSeNm}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLOR_TEXT_MAIN }}>안내 중 경로 변경 감지</span>
        </div>
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", fontSize: 14, color: COLOR_TEXT_SUB, cursor: "pointer", padding: 0 }}
        >✕</button>
      </div>

      {/* 재난 요약 */}
      <div style={{ padding: "8px 14px 10px", fontSize: 12, color: COLOR_TEXT_SUB, lineHeight: 1.5 }}>
        {alert.summary}
      </div>

      {/* 경로 비교 카드 2개 */}
      <div style={{ padding: "0 14px 14px", display: "flex", gap: 8 }}>

        {/* 원래 경로 유지 */}
        <button
          onClick={onKeep}
          style={{
            flex: 1, textAlign: "left",
            padding: "12px 12px", borderRadius: 12,
            border: `1.5px solid ${COLOR_BORDER}`,
            background: COLOR_SURFACE, cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <div style={{ width: 10, height: 3, borderRadius: 2, background: "#9CA3AF" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: COLOR_TEXT_MAIN }}>현재 경로 유지</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: COLOR_TEXT_MAIN }}>
            {fmt.duration(MOCK_ROUTE_INFO.current.durationSec)}
          </div>
          <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginTop: 2 }}>
            {fmt.distance(MOCK_ROUTE_INFO.current.distanceM)}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#e53e3e", fontWeight: 600 }}>
            ⚠ 이벤트 구간 통과
          </div>
        </button>

        {/* 경로 변경 */}
        <button
          onClick={onDetour}
          style={{
            flex: 1, textAlign: "left",
            padding: "12px 12px", borderRadius: 12,
            border: `1.5px solid ${color.border}`,
            background: color.light, cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <div style={{ width: 10, height: 3, borderRadius: 2, background: TRAFFIC_COLOR_MAP[0] }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: COLOR_TEXT_MAIN }}>경로 변경</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: color.main, padding: "1px 5px", borderRadius: 4 }}>추천</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: TRAFFIC_COLOR_MAP[0] }}>
            {fmt.duration(MOCK_ROUTE_INFO.detour.durationSec)}
          </div>
          <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginTop: 2 }}>
            {fmt.distance(MOCK_ROUTE_INFO.detour.distanceM)}
          </div>
          {/* 차이 표시 */}
          <div style={{ marginTop: 6, fontSize: 10, color: color.main, fontWeight: 600 }}>
            +{fmt.duration(MOCK_ROUTE_INFO.detour.durationSec - MOCK_ROUTE_INFO.current.durationSec)} · 안전 우회
          </div>
        </button>

      </div>

      {/* 하단 강조 바 */}
      <div style={{ height: 3, background: color.main, opacity: 0.7 }} />
    </div>
  );
};

// ── [SUB] RouteChoiceSheet ────────────────────────────────

const RouteChoiceSheet: FC<RouteChoiceSheetProps> = ({
  alert, onClose, onSelectRoute, kakaoMapRef,
}) => {
  const color = DST_COLOR[alert.dstSeNm];
  const polylineListRef = useRef<KakaoPolyline[]>([]);
  const overlayListRef  = useRef<KakaoOverlay[]>([]);

  // [LOGIC] 시트 오픈 시 이중 경로 지도에 표시
  useEffect(() => {
    const map = kakaoMapRef?.current;
    if (!map) return;

    // 기존 레이어 정리
    polylineListRef.current.forEach(p => p.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = [];
    overlayListRef.current  = [];

    // [TODO] 실제 경로 데이터: /api/directions 응답의 roads 배열로 교체
    // 현재: 재난 위치 기준 Mock 좌표로 시각적 시연
    const centerLat = alert.lat ?? 37.5665;
    const centerLng = alert.lng ?? 126.9780;

    // [UI] 기존 경로 (회색 폴리라인)
    const currentPath = [
      new window.kakao.maps.LatLng(centerLat - 0.008, centerLng - 0.012),
      new window.kakao.maps.LatLng(centerLat - 0.003, centerLng - 0.004),
      new window.kakao.maps.LatLng(centerLat,         centerLng),
      new window.kakao.maps.LatLng(centerLat + 0.004, centerLng + 0.006),
      new window.kakao.maps.LatLng(centerLat + 0.009, centerLng + 0.013),
    ];
    polylineListRef.current.push(new window.kakao.maps.Polyline({
      map,
      path:           currentPath,
      strokeWeight:   5,
      strokeColor:    "#9CA3AF",
      strokeOpacity:  0.7,
      strokeStyle:    "solid",
    }));

    // [UI] 우회 경로 (컬러 폴리라인)
    const detourPath = [
      new window.kakao.maps.LatLng(centerLat - 0.008, centerLng - 0.012),
      new window.kakao.maps.LatLng(centerLat - 0.006, centerLng + 0.006),
      new window.kakao.maps.LatLng(centerLat + 0.002, centerLng + 0.010),
      new window.kakao.maps.LatLng(centerLat + 0.009, centerLng + 0.013),
    ];
    polylineListRef.current.push(new window.kakao.maps.Polyline({
      map,
      path:           detourPath,
      strokeWeight:   5,
      strokeColor:    TRAFFIC_COLOR_MAP[0],
      strokeOpacity:  0.9,
      strokeStyle:    "solid",
    }));

    // [UI] 경로 라벨 오버레이
    const makeLabel = (lat: number, lng: number, text: string, color: string) => {
      const el = document.createElement("div");
      el.innerHTML = `<div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;font-family:'Noto Sans KR',sans-serif;">${text}</div>`;
      overlayListRef.current.push(new window.kakao.maps.CustomOverlay({
        map, content: el, zIndex: 20,
        position: new window.kakao.maps.LatLng(lat, lng),
      }));
    };
    makeLabel(centerLat - 0.001, centerLng - 0.003, "현재 경로", "#9CA3AF");
    makeLabel(centerLat + 0.001, centerLng + 0.008, "우회 경로", TRAFFIC_COLOR_MAP[0]);

    // [UI] 지도 범위 자동 맞춤
    const bounds = new window.kakao.maps.LatLngBounds();
    [...currentPath, ...detourPath].forEach(p => bounds.extend(p));
    map.setBounds(bounds, 60, 60, 60, 200);

    return () => {
      polylineListRef.current.forEach(p => p.setMap(null));
      overlayListRef.current.forEach(o => o.setMap(null));
      polylineListRef.current = [];
      overlayListRef.current  = [];
    };
  }, [alert.id, kakaoMapRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 960,
        display: "flex", alignItems: "flex-end",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%",
          background: COLOR_SURFACE,
          borderRadius: "20px 20px 0 0",
          borderTop: `3px solid ${color.border}`,
          padding: "12px 20px 40px",
          animation: "slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
        }}
      >
        {/* 핸들 */}
        <div style={{ width: 36, height: 4, background: COLOR_BORDER, borderRadius: 2, margin: "0 auto 16px" }} />

        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: color.main, color: "#fff",
            fontSize: 11, fontWeight: 700,
            padding: "3px 10px", borderRadius: 20,
          }}>
            <span>{DST_ICON[alert.dstSeNm]}</span>
            <span>{alert.dstSeNm}</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 16, color: COLOR_TEXT_SUB, cursor: "pointer" }}
          >✕</button>
        </div>

        {/* 재난문자 내용 박스 */}
        <div style={{
          background: color.light, borderRadius: 12,
          padding: "12px 14px", marginBottom: 16,
          border: `1px solid ${color.border}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLOR_TEXT_SUB, marginBottom: 4 }}>
            {alert.rcptnRgnNm} · {alert.crtDt} 발송
          </div>
          <div style={{ fontSize: 13, color: COLOR_TEXT_MAIN, lineHeight: 1.65 }}>
            {alert.msgCn}
          </div>
        </div>

        {/* AI 제안 라벨 */}
        <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, marginBottom: 4 }}>
          🤖 AI 경로 제안
        </div>
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginBottom: 14, lineHeight: 1.5 }}>
          현재 경로 상에 <strong>{alert.dstSeNm}</strong> 이벤트가 감지되었어요. 원하는 경로를 선택해 주세요.
        </div>

        {/* 경로 범례 */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 24, height: 4, borderRadius: 2, background: "#9CA3AF" }} />
            <span style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>현재 경로</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 24, height: 4, borderRadius: 2, background: TRAFFIC_COLOR_MAP[0] }} />
            <span style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>우회 경로</span>
          </div>
        </div>

        {/* 경로 선택 카드 2개 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* 우회 경로 */}
          <button
            onClick={() => onSelectRoute(true)}
            style={{
              width: "100%", textAlign: "left",
              padding: "14px 16px", borderRadius: 12,
              border: `1.5px solid ${color.border}`,
              background: color.light, cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 12, height: 4, borderRadius: 2, background: TRAFFIC_COLOR_MAP[0], flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN }}>우회 경로로 변경</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#fff",
                  background: color.main, padding: "2px 7px", borderRadius: 4,
                }}>추천</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: TRAFFIC_COLOR_MAP[0] }}>
                {fmt.duration(MOCK_ROUTE_INFO.detour.durationSec)}
              </span>
              <span style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>
                {fmt.distance(MOCK_ROUTE_INFO.detour.distanceM)}
              </span>
              <span style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>
                +{fmt.duration(MOCK_ROUTE_INFO.detour.durationSec - MOCK_ROUTE_INFO.current.durationSec)} 추가
              </span>
            </div>
            <div style={{ fontSize: 11, color: color.main, fontWeight: 600 }}>이벤트 구간 우회 · 안전한 경로</div>
          </button>

          {/* 현재 경로 유지 */}
          <button
            onClick={() => onSelectRoute(false)}
            style={{
              width: "100%", textAlign: "left",
              padding: "14px 16px", borderRadius: 12,
              border: `1.5px solid ${COLOR_BORDER}`,
              background: COLOR_SURFACE, cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 12, height: 4, borderRadius: 2, background: "#9CA3AF", flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN }}>현재 경로 유지</span>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: COLOR_TEXT_MAIN }}>
                {fmt.duration(MOCK_ROUTE_INFO.current.durationSec)}
              </span>
              <span style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>
                {fmt.distance(MOCK_ROUTE_INFO.current.distanceM)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>이벤트 구간 통과 · 지연 발생 가능</div>
          </button>

        </div>
      </div>
    </div>
  );
};

// ── [SUB] RouteSelectToast ────────────────────────────────

const RouteSelectToast: FC<{ isDetour: boolean; onHide: () => void }> = ({ isDetour, onHide }) => {
  useEffect(() => {
    const t = setTimeout(onHide, 2500);
    return () => clearTimeout(t);
  }, [onHide]);

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { transform: translateY(-20px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
      `}</style>
      <div style={{
        position:   "fixed",
        top:        80,
        left:       "50%",
        transform:  "translateX(-50%)",
        zIndex:     970,
        background: isDetour ? TRAFFIC_COLOR_MAP[0] : COLOR_TEXT_MAIN,
        color:      "#fff",
        fontSize:   13,
        fontWeight: 700,
        padding:    "10px 20px",
        borderRadius: 24,
        boxShadow:  "0 4px 16px rgba(0,0,0,0.18)",
        whiteSpace: "nowrap",
        animation:  "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
        fontFamily: "'Noto Sans KR', sans-serif",
      }}>
        {isDetour ? "🗺 우회 경로로 변경되었습니다" : "현재 경로를 유지합니다"}
      </div>
    </>
  );
};

// ── [MAIN] DisasterAlertBanner ────────────────────────────

const DisasterAlertBanner: FC<DisasterAlertBannerProps> = ({
  currentAlert, alertQueue, remainingSec, onDismiss, onSelectRoute, kakaoMapRef,
  isNavigating = false,
}) => {
  const [isSheetOpen,  setIsSheetOpen]  = useState<boolean>(false);
  const [isVisible,    setIsVisible]    = useState<boolean>(false);
  const [isClosing,    setIsClosing]    = useState<boolean>(false);
  const [toastDetour,  setToastDetour]  = useState<boolean | null>(null);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentAlert) {
      setIsClosing(true);
      setTimeout(() => { setIsVisible(false); setIsClosing(false); }, 300);
      return;
    }
    if (currentAlert.id !== prevIdRef.current) {
      prevIdRef.current = currentAlert.id;
      setIsVisible(true);
      setIsClosing(false);
      if (currentAlert.dstSeNm === "긴급재난") setIsSheetOpen(true);
    }
  }, [currentAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = useCallback(() => {
    setIsSheetOpen(false);
    setIsClosing(true);
    setTimeout(() => { setIsVisible(false); setIsClosing(false); onDismiss(); }, 300);
  }, [onDismiss]);

  const handleSelectRoute = useCallback((isDetour: boolean) => {
    setIsSheetOpen(false);
    setToastDetour(isDetour);
    handleDismiss();
    onSelectRoute(isDetour);
  }, [handleDismiss, onSelectRoute]);

  if (!isVisible || !currentAlert) return (
    <>
      {toastDetour !== null && (
        <RouteSelectToast isDetour={toastDetour} onHide={() => setToastDetour(null)} />
      )}
    </>
  );

  // [NAV] 안내 중 재난 감지 시 → 경로 선택 카드 표시
  if (isNavigating) {
    return (
      <>
        <style>{`@keyframes slideUpBanner { from { transform:translateY(120%);opacity:0; } to { transform:translateY(0);opacity:1; } }`}</style>
        {toastDetour !== null && (
          <RouteSelectToast isDetour={toastDetour} onHide={() => setToastDetour(null)} />
        )}
        <NavigationDisasterCard
          alert={currentAlert}
          onKeep={() => {
            setToastDetour(false);
            handleDismiss();
            onSelectRoute(false);
          }}
          onDetour={() => {
            setToastDetour(true);
            handleDismiss();
            onSelectRoute(true);
          }}
          onDismiss={handleDismiss}
        />
      </>
    );
  }

  const color    = DST_COLOR[currentAlert.dstSeNm];
  const total    = TIMEOUT_TOTAL_SEC[currentAlert.dstSeNm];
  const progress = Math.min(100, (remainingSec / total) * 100);
  const queueLen = alertQueue.length;
  const queueIdx = alertQueue.findIndex(a => a.id === currentAlert.id);

  return (
    <>
      <style>{`
        @keyframes slideUpBanner {
          from { transform: translateY(120%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes slideDownBanner {
          from { transform: translateY(0);    opacity: 1; }
          to   { transform: translateY(120%); opacity: 0; }
        }
        @keyframes shakeAlert {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-5px); }
          40%      { transform: translateX(5px); }
          60%      { transform: translateX(-3px); }
          80%      { transform: translateX(3px); }
        }
        @keyframes toastIn {
          from { transform: translate(-50%, -20px); opacity: 0; }
          to   { transform: translate(-50%, 0);     opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* 토스트 */}
      {toastDetour !== null && (
        <RouteSelectToast isDetour={toastDetour} onHide={() => setToastDetour(null)} />
      )}

      {/* 배너 */}
      <div style={{
        position:   "fixed",
        bottom:     90,
        left:       16,
        right:      16,
        zIndex:     900,
        background: COLOR_SURFACE,
        borderRadius: 16,
        border:     `1.5px solid ${color.border}`,
        boxShadow:  "0 8px 32px rgba(0,0,0,0.13)",
        overflow:   "hidden",
        animation:  isClosing
          ? "slideDownBanner 0.3s ease forwards"
          : currentAlert.dstSeNm === "긴급재난"
            ? "slideUpBanner 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards, shakeAlert 0.5s ease 0.4s"
            : "slideUpBanner 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}>
        <div
          onClick={() => {
            // [LOGIC] 배너 클릭 시 재난 위치로 지도 포커싱
            if (kakaoMapRef?.current && currentAlert.lat && currentAlert.lng) {
              kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(currentAlert.lat, currentAlert.lng));
              kakaoMapRef.current.setLevel(4);
            }
            // [LOGIC] 안내 중일 때만 시트 열기
            if (isNavigating) setIsSheetOpen(true);
          }}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "13px 14px", cursor: "pointer" }}
        >
          {/* 왼쪽 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: color.main, color: "#fff",
              fontSize: 10, fontWeight: 700,
              padding: "2px 8px", borderRadius: 20, marginBottom: 5,
            }}>
              <span>{DST_ICON[currentAlert.dstSeNm]}</span>
              <span>{currentAlert.dstSeNm}</span>
            </div>
            <div style={{
              fontSize: 13, fontWeight: 600, color: COLOR_TEXT_MAIN,
              marginBottom: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {currentAlert.summary}
            </div>
            <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>
              {currentAlert.rcptnRgnNm} · {currentAlert.crtDt}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
            {queueLen > 1 && (
              <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{queueIdx + 1}/{queueLen}</span>
            )}
            {/* [LOGIC] 안내 중일 때만 경로 선택 버튼 표시 */}
            {isNavigating && (
              <div
                onClick={e => { e.stopPropagation(); setIsSheetOpen(true); }}
                style={{
                  background: color.main, color: "#fff",
                  fontSize: 11, fontWeight: 700,
                  padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                경로 선택
              </div>
            )}
            <button
              onClick={e => { e.stopPropagation(); handleDismiss(); }}
              style={{ background: "none", border: "none", fontSize: 14, color: COLOR_TEXT_SUB, cursor: "pointer", padding: 0, lineHeight: 1 }}
            >✕</button>
          </div>
        </div>

        {/* 타임아웃 프로그레스 바 */}
        <div style={{ height: 3, background: COLOR_BG }}>
          <div style={{
            height: "100%",
            width:  `${progress}%`,
            background: color.main,
            transition: "width 1s linear",
            borderRadius: "0 2px 2px 0",
          }} />
        </div>
      </div>

      {/* 경로 선택 시트 */}
      {isSheetOpen && (
        <RouteChoiceSheet
          alert={currentAlert}
          onClose={() => setIsSheetOpen(false)}
          onSelectRoute={handleSelectRoute}
          kakaoMapRef={kakaoMapRef}
        />
      )}
    </>
  );
};

export default DisasterAlertBanner;