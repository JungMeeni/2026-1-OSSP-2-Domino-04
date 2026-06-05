// ═══════════════════════════════════════════════════════════
// DisasterAlertBanner — 재난 알림 정보 배너 (정보 표시 전용)
//
// [구조]
//   - 상단 고정 배너: 재난 유형 배지 + 요약 + 발송 지역/시간
//   - 배너 클릭 → 지도를 재난 위치로 포커싱
//   - 하단 타임아웃 프로그레스 바
//   - 알림 큐 카운터 (2개 이상 수신 시)
//
// [경로 선택 모달]
//   경로 선택(우회 여부)은 RouteScreen 레벨에서 처리.
//   사용자가 재난 구역을 지나는 경로를 선택할 때 RouteScreen이
//   DisasterRouteChoiceModal을 띄워 처리한다.
// ═══════════════════════════════════════════════════════════

import { type FC, useState, useEffect, useRef, useCallback } from "react";
import type { DisasterAlert, DisasterType } from "../hooks/UseDisasterAlert";
import type { KakaoMapInstance } from "../types/type_kakao";
import {
  COLOR_PRIMARY,
  COLOR_SURFACE,
  COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_DANGER, COLOR_BG,
} from "../colors";

// ── [CONFIG] 재난 유형별 색상 ─────────────────────────────

const DST_COLOR: Record<DisasterType, { main: string; border: string }> = {
  호우:     { main: "#2563EB", border: "#BFDBFE" },
  교통통제: { main: COLOR_PRIMARY, border: "#FDD99A" },
  긴급재난: { main: COLOR_DANGER,  border: "#FECDD3" },
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

// ── [TYPE] ────────────────────────────────────────────────

interface DisasterAlertBannerProps {
  currentAlert: DisasterAlert | null;
  alertQueue:   DisasterAlert[];
  remainingSec: number;
  onDismiss:    () => void;
  kakaoMapRef?: { current: KakaoMapInstance | null };
}

// ── [MAIN] DisasterAlertBanner ────────────────────────────

const DisasterAlertBanner: FC<DisasterAlertBannerProps> = ({
  currentAlert, alertQueue, remainingSec, onDismiss, kakaoMapRef,
}) => {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
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
    }
  }, [currentAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => { setIsVisible(false); setIsClosing(false); onDismiss(); }, 300);
  }, [onDismiss]);

  if (!isVisible || !currentAlert) return null;

  const color    = DST_COLOR[currentAlert.dstSeNm];
  const total    = TIMEOUT_TOTAL_SEC[currentAlert.dstSeNm];
  const progress = Math.min(100, (remainingSec / total) * 100);
  const queueLen = alertQueue.length;
  const queueIdx = alertQueue.findIndex(a => a.id === currentAlert.id);

  return (
    <>
      <style>{`
        @keyframes slideUpBanner {
          from { transform: translateY(-120%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes slideDownBanner {
          from { transform: translateY(0);     opacity: 1; }
          to   { transform: translateY(-120%); opacity: 0; }
        }
        @keyframes shakeAlert {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-5px); }
          40%     { transform: translateX(5px); }
          60%     { transform: translateX(-3px); }
          80%     { transform: translateX(3px); }
        }
      `}</style>

      <div style={{
        position:   "fixed",
        top:        120,
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
        {/* 배너 본문 — 클릭 시 지도 포커싱만 */}
        <div
          onClick={() => {
            if (kakaoMapRef?.current && currentAlert.lat && currentAlert.lng) {
              kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(currentAlert.lat, currentAlert.lng));
              kakaoMapRef.current.setLevel(4);
            }
          }}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "13px 14px", cursor: "pointer" }}
        >
          {/* 재난 정보 */}
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

          {/* 큐 카운터 + 닫기 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
            {queueLen > 1 && (
              <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{queueIdx + 1}/{queueLen}</span>
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
    </>
  );
};

export default DisasterAlertBanner;
