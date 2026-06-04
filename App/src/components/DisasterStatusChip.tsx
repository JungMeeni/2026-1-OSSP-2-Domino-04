// ═══════════════════════════════════════════════════════════
// DisasterStatusChip — 재난 현황 플로팅 배지
//
// [구조]
//   - 지도 우측 상단 고정 플로팅 UI
//   - 활성 재난 없음: 숨김
//   - 활성 재난 1개: 유형 배지 + 요약 한 줄
//   - 활성 재난 2개 이상: "🚨 재난 N건" 숫자 배지
//   - 탭 시 DisasterHistorySheet 펼침
//
// [Props]
//   activeAlerts  — 현재 활성 재난 목록
//   alertQueue    — 전체 알림 큐 (히스토리용)
// ═══════════════════════════════════════════════════════════

import { type FC, useState } from "react";
import type { DisasterAlert, DisasterType } from "../hooks/UseDisasterAlert";
import {
  COLOR_SURFACE, COLOR_BORDER, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_DANGER, COLOR_BG,
} from "../colors";

// ── [CONFIG] ──────────────────────────────────────────────

const DST_COLOR: Record<DisasterType, { main: string; light: string; border: string }> = {
  호우:     { main: "#2563EB", light: "#EFF6FF", border: "#BFDBFE" },
  교통통제: { main: "#EA580C", light: "#FFF7ED", border: "#FED7AA" },
  긴급재난: { main: COLOR_DANGER, light: "#FFF1F2", border: "#FECDD3" },
};

const DST_ICON: Record<DisasterType, string> = {
  호우:     "🌧️",
  교통통제: "🚧",
  긴급재난: "🚨",
};

// ── [TYPE] ────────────────────────────────────────────────

interface DisasterStatusChipProps {
  activeAlerts: DisasterAlert[];
  alertQueue:   DisasterAlert[];
}

interface DisasterHistorySheetProps {
  alertQueue: DisasterAlert[];
  onClose:    () => void;
}

// ── [SUB] DisasterHistorySheet ────────────────────────────

const DisasterHistorySheet: FC<DisasterHistorySheetProps> = ({ alertQueue, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.35)",
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
        padding: "12px 20px 40px",
        maxHeight: "60vh",
        overflowY: "auto",
        animation: "slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}
    >
      {/* 핸들 */}
      <div style={{ width: 36, height: 4, background: COLOR_BORDER, borderRadius: 2, margin: "0 auto 16px" }} />

      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLOR_TEXT_MAIN }}>재난 알림 현황</div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", fontSize: 16, color: COLOR_TEXT_SUB, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* 알림 목록 */}
      {alertQueue.length === 0
        ? (
          <div style={{ textAlign: "center", color: COLOR_TEXT_SUB, fontSize: 13, padding: "32px 0" }}>
            현재 활성 재난 알림이 없어요
          </div>
        )
        : alertQueue.map(alert => {
          const color = DST_COLOR[alert.dstSeNm];
          return (
            <div
              key={alert.id}
              style={{
                marginBottom: 10, padding: "12px 14px",
                borderRadius: 12, border: `1.5px solid ${color.border}`,
                background: color.light,
              }}
            >
              {/* 배지 + 시간 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: color.main, color: "#fff",
                  fontSize: 10, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 20,
                }}>
                  <span>{DST_ICON[alert.dstSeNm]}</span>
                  <span>{alert.dstSeNm}</span>
                </div>
                <span style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{alert.crtDt}</span>
              </div>

              {/* 요약 */}
              <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT_MAIN, marginBottom: 4 }}>
                {alert.summary}
              </div>

              {/* 지역 */}
              <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>
                📍 {alert.rcptnRgnNm}
              </div>

              {/* 원문 */}
              <div style={{
                marginTop: 8, fontSize: 11, color: COLOR_TEXT_SUB,
                lineHeight: 1.6, background: COLOR_SURFACE,
                borderRadius: 8, padding: "8px 10px",
                border: `1px solid ${COLOR_BORDER}`,
              }}>
                {alert.msgCn}
              </div>
            </div>
          );
        })
      }
    </div>
  </div>
);

// ── [MAIN] DisasterStatusChip ─────────────────────────────

const DisasterStatusChip: FC<DisasterStatusChipProps> = ({ activeAlerts, alertQueue }) => {
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);

  // [LOGIC] 활성 재난 없으면 렌더 안 함
  if (activeAlerts.length === 0) return null;

  // [LOGIC] 가장 심각한 재난 우선 표시 (긴급재난 > 교통통제 > 호우)
  const PRIORITY: Record<DisasterType, number> = { 긴급재난: 3, 교통통제: 2, 호우: 1 };
  const topAlert = [...activeAlerts].sort(
    (a, b) => PRIORITY[b.dstSeNm] - PRIORITY[a.dstSeNm]
  )[0];
  const color = DST_COLOR[topAlert.dstSeNm];

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes pulseChip {
          0%, 100% { box-shadow: 0 0 0 0 ${color.main}40; }
          50%       { box-shadow: 0 0 0 6px ${color.main}00; }
        }
      `}</style>

      {/* [UI] 플로팅 배지 */}
      <div
        onClick={() => setIsSheetOpen(true)}
        style={{
          position:   "fixed",
          top:        80,     // [CONFIG] 검색창 아래
          right:      16,
          zIndex:     910,
          background: COLOR_SURFACE,
          borderRadius: 12,
          border:     `1.5px solid ${color.border}`,
          padding:    "7px 12px",
          boxShadow:  "0 4px 16px rgba(0,0,0,0.12)",
          cursor:     "pointer",
          animation:  "pulseChip 2s ease-in-out infinite",
          display:    "flex",
          alignItems: "center",
          gap:        8,
        }}
      >
        {/* 유형 배지 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: color.main, color: "#fff",
          fontSize: 10, fontWeight: 700,
          padding: "2px 7px", borderRadius: 20,
          flexShrink: 0,
        }}>
          <span>{DST_ICON[topAlert.dstSeNm]}</span>
          <span>{topAlert.dstSeNm}</span>
        </div>

        {/* 요약 or 건수 */}
        {activeAlerts.length === 1
          ? (
            <span style={{
              fontSize: 11, fontWeight: 600, color: COLOR_TEXT_MAIN,
              maxWidth: 100, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {topAlert.summary}
            </span>
          )
          : (
            <span style={{ fontSize: 11, fontWeight: 700, color: color.main }}>
              {activeAlerts.length}건 발생
            </span>
          )
        }

        {/* 화살표 */}
        <span style={{ fontSize: 10, color: COLOR_TEXT_SUB, flexShrink: 0 }}>›</span>
      </div>

      {/* [UI] 히스토리 시트 */}
      {isSheetOpen && (
        <DisasterHistorySheet
          alertQueue={alertQueue}
          onClose={() => setIsSheetOpen(false)}
        />
      )}
    </>
  );
};

export default DisasterStatusChip;