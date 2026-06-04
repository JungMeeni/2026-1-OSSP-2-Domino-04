// ═══════════════════════════════════════════════════════════
// useDisasterAlert — 재난 알림 큐 + 타임아웃 관리 훅
//
// [구조]
//   - useMock=true:  Mock 데이터로 테스트
//   - useMock=false: GET /disaster/active 30초 폴링
//   - alertQueue: 수신된 알림 목록 (최대 MAX_QUEUE_SIZE개)
//   - currentAlert: 현재 배너에 표시 중인 알림
//   - 알림 유형별 타임아웃 자동 해제
//
// [API 응답 -> DisasterAlert 매핑]
//   id            <- String(row.id)
//   dstSeNm       <- weight_penalty 기준 유형 판단
//   msgCn         <- row.message
//   summary       <- row.message 앞 30자 (LLM 연동 전 임시)
//   rcptnRgnNm    <- "서울시 실시간 데이터"
//   lat/lng       <- row.lat / row.lng (ST_X/ST_Y 결과)
//   radiusM       <- row.radius_m
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from "react";

// ── [TYPE] ────────────────────────────────────────────────

export type DisasterType = "호우" | "교통통제" | "긴급재난";

export interface DisasterAlert {
  id:          string;
  dstSeNm:     DisasterType;
  msgCn:       string;
  summary:     string;
  rcptnRgnNm:  string;
  crtDt:       string;
  receivedAt:  number;
  lat?:        number;
  lng?:        number;
  radiusM?:    number;
}

// ── [CONFIG] ──────────────────────────────────────────────

const TIMEOUT_MS: Record<DisasterType, number> = {
  긴급재난: 30 * 60 * 1000,
  교통통제:  2 * 60 * 60 * 1000,
  호우:      6 * 60 * 60 * 1000,
};

const MAX_QUEUE_SIZE = 10;

// [API] 폴링 간격 30초
const POLL_INTERVAL_MS = 30 * 1000;

// [CONFIG] weight_penalty -> DisasterType 매핑
const penaltyToType = (penalty: number): DisasterType => {
  if (penalty >= 100) return "긴급재난";
  if (penalty >= 60)  return "교통통제";
  return "호우";
};

// [CONFIG] Mock 알림 데이터 — useMock=true 시에만 사용
const MOCK_ALERTS: Omit<DisasterAlert, "receivedAt">[] = [
  {
    id:         "mock-1",
    dstSeNm:    "교통통제",
    msgCn:      "[용산구] 이촌역 1번출구 앞 도로 공사로 인해 이촌역에서 용산역 방향 도로 통제 중이니 우회하여 주시기 바랍니다.",
    summary:    "이촌역 앞 도로 공사 — 용산역 방향 통제",
    lat:        37.5176,
    lng:        126.9688,
    radiusM:    400,
    rcptnRgnNm: "서울특별시 용산구 이촌동",
    crtDt:      "2025-05-18 14:26",
  },
  {
    id:         "mock-2",
    dstSeNm:    "호우",
    msgCn:      "[행정안전부] 용산구 일대 호우경보. 한강 수위 상승으로 한강변 산책로 통제, 외출자제 등 안전에 주의바랍니다.",
    summary:    "용산구 호우경보 — 한강변 통제",
    lat:        37.5219,
    lng:        126.9647,
    radiusM:    800,
    rcptnRgnNm: "서울특별시 용산구 전체",
    crtDt:      "2025-05-18 20:30",
  },
  {
    id:         "mock-3",
    dstSeNm:    "긴급재난",
    msgCn:      "[기상청] 용산철도고등학교 인근 시간당 70mm 이상 강한 비로 침수 즉시 대피 요망. 지하차도 접근 금지.",
    summary:    "용산 철도고 인근 침수 — 즉시 대피",
    lat:        37.5243,
    lng:        126.9615,
    radiusM:    350,
    rcptnRgnNm: "서울특별시 용산구 한강로동",
    crtDt:      "2025-05-18 20:33",
  },
];

// ── [HOOK] ────────────────────────────────────────────────

interface UseDisasterAlertReturn {
  currentAlert:   DisasterAlert | null;
  alertQueue:     DisasterAlert[];
  remainingSec:   number;
  pushAlert:      (alert: Omit<DisasterAlert, "receivedAt">) => void;
  dismissCurrent: () => void;
  dismissAll:     () => void;
}

export const useDisasterAlert = (useMock = true): UseDisasterAlertReturn => {
  const [alertQueue,   setAlertQueue]   = useState<DisasterAlert[]>([]);
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIdsRef  = useRef<Set<string>>(new Set());

  // [ACTION] 외부에서 알림 추가
  const pushAlert = useCallback((alert: Omit<DisasterAlert, "receivedAt">) => {
    setAlertQueue(prev => {
      if (prev.some(a => a.id === alert.id)) return prev;
      const next = [...prev, { ...alert, receivedAt: Date.now() }];
      return next.length > MAX_QUEUE_SIZE ? next.slice(-MAX_QUEUE_SIZE) : next;
    });
  }, []);

  // [CONFIG] Mock 데이터 로드 (useMock=true)
  useEffect(() => {
    if (!useMock) return;
    const timers = MOCK_ALERTS.map((alert, i) =>
      setTimeout(() => pushAlert(alert), 15000 + i * 3000)
    );
    return () => timers.forEach(clearTimeout);
  }, [useMock, pushAlert]);

  // [API] 실제 폴링 (useMock=false)
  useEffect(() => {
    if (useMock) return;

    const fetchActive = async () => {
      try {
        // [API] FastAPI /disaster/active 직접 호출 (PROD: VITE_BACKEND_URL, DEV: Vite /api 프록시)
        const _BASE = import.meta.env.VITE_BACKEND_URL ?? "";
        const res = await fetch(`${_BASE}/api/disaster/active`);
        if (!res.ok) return;
        const json = await res.json();

        (json.data ?? []).forEach((row: {
          id: number;
          message: string;
          lat: number;
          lng: number;
          radius_m: number;
          weight_penalty: number;
          received_at: string;
          expires_at: string;
        }) => {
          const strId = String(row.id);
          if (seenIdsRef.current.has(strId)) return;
          seenIdsRef.current.add(strId);

          pushAlert({
            id:         strId,
            dstSeNm:    penaltyToType(row.weight_penalty),
            msgCn:      row.message,
            summary:    row.message.slice(0, 30) + (row.message.length > 30 ? "..." : ""),
            rcptnRgnNm: "서울시 실시간 데이터",
            crtDt:      row.received_at?.slice(0, 16) ?? "",
            lat: row.lng,   // API 응답의 lng가 실제 위도
            lng: row.lat,   // API 응답의 lat이 실제 경도
            radiusM:    row.radius_m,
          });
        });
      } catch (e) {
        console.warn("[useDisasterAlert] 폴링 실패:", e);
      }
    };

    fetchActive();
    const interval = setInterval(fetchActive, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [useMock, pushAlert]);

  const currentAlert = alertQueue[0] ?? null;

  // [LOGIC] 타임아웃 카운트다운
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!currentAlert) { setRemainingSec(0); return; }

    const timeoutMs = TIMEOUT_MS[currentAlert.dstSeNm];
    const calcRemaining = () => {
      const elapsed = Date.now() - currentAlert.receivedAt;
      return Math.max(0, Math.round((timeoutMs - elapsed) / 1000));
    };

    setRemainingSec(calcRemaining());
    timerRef.current = setInterval(() => {
      const rem = calcRemaining();
      setRemainingSec(rem);
      if (rem <= 0) setAlertQueue(prev => prev.slice(1));
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissCurrent = useCallback(() => {
    setAlertQueue(prev => prev.slice(1));
  }, []);

  const dismissAll = useCallback(() => {
    setAlertQueue([]);
  }, []);

  return { currentAlert, alertQueue, remainingSec, pushAlert, dismissCurrent, dismissAll };
};