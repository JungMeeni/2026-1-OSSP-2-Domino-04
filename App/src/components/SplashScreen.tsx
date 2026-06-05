// ═══════════════════════════════════════════════════════════
// SplashScreen — 앱 초기 로딩 화면
//
// [구조]
//   - 풀스크린 그라디언트 배경 + 로고 + 앱 이름 + 도트 인디케이터
//   - isLoading=false 시점에 페이드아웃 시작 → DOM에서 제거
//
// [설정 포인트]
//   SPLASH_IMAGE_SRC — null이면 SVG 플레이스홀더, 경로 지정 시 이미지 표시
//   FADE_DURATION_MS — 페이드아웃 지속 시간 (기본 400ms)
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useState } from "react";
import { COLOR_PRIMARY, COLOR_PRIMARY_DARK } from "../colors";

// ── 이미지 교체 포인트
// [CONFIG] 실제 로고/이미지로 교체 시 이 경로만 수정
// 예: import splashImg from "../assets/splash_logo.png";
//     const SPLASH_IMAGE_SRC = splashImg;
const SPLASH_IMAGE_SRC = "./Lin-K-transparent.png"; // null이면 SVG 플레이스홀더 표시

// [CONFIG] 페이드아웃 시작 딜레이 (ms) — isLoading=false 직후 시작
const FADE_DURATION_MS = 400;

interface SplashScreenProps {
  isLoading: boolean;
}

const SplashScreen: FC<SplashScreenProps> = ({ isLoading }) => {
  const [isVisible,  setIsVisible]  = useState<boolean>(true);
  const [isFadingOut, setIsFadingOut] = useState<boolean>(false);

  useEffect(() => {
    if (!isLoading) {
      // 로딩 완료 → 페이드아웃 시작
      setIsFadingOut(true);
      const timer = setTimeout(() => setIsVisible(false), FADE_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  if (!isVisible) return null;

  return (
    <>
      {/* 애니메이션 키프레임 */}
      <style>{`
        @keyframes splash-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes splash-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.7; transform: scale(0.96); }
        }
        @keyframes splash-dot {
          0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
          40%           { transform: scale(1);   opacity: 1; }
        }
      `}</style>

      <div style={{
        position:       "fixed",
        inset:          0,
        zIndex:         9999,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        background:     `linear-gradient(160deg, ${COLOR_PRIMARY} 0%, ${COLOR_PRIMARY_DARK} 100%)`,
        opacity:        isFadingOut ? 0 : 1,
        transition:     `opacity ${FADE_DURATION_MS}ms ease`,
        userSelect:     "none",
      }}>

        {/* ── 이미지 / 플레이스홀더 */}
        <div style={{
          animation: "splash-pulse 2s ease-in-out infinite",
          marginBottom: 40,
          background: "rgba(255,255,255)",
          borderRadius: 24,
          padding: 12,
        }}>
          {SPLASH_IMAGE_SRC
            ? (
              // [REPLACE] 실제 이미지로 교체 시 아래 img 태그 사용
              <img
                src={SPLASH_IMAGE_SRC}
                alt="앱 로고"
                style={{ width: 120, height: 120, objectFit: "contain" }}
              />
            )
            : (
              // [PLACEHOLDER] 임시 SVG 로고 — 이미지 준비되면 위 img로 교체
              <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* 원형 배경 */}
                <circle cx="60" cy="60" r="56" fill="rgba(255,255,255,0.18)" />
                <circle cx="60" cy="60" r="44" fill="rgba(255,255,255,0.22)" />
                {/* 지도 핀 실루엣 */}
                <path
                  d="M60 22C46.2 22 35 33.2 35 47C35 58.6 52.4 80.4 58.2 87.4C59.2 88.6 60.8 88.6 61.8 87.4C67.6 80.4 85 58.6 85 47C85 33.2 73.8 22 60 22Z"
                  fill="white"
                  opacity="0.95"
                />
                {/* 핀 중심 원 */}
                <circle cx="60" cy="47" r="10" fill={COLOR_PRIMARY} />
              </svg>
            )
          }
        </div>

        {/* ── 앱 이름 */}
        <div style={{
          fontSize:      28,
          fontWeight:    900,
          color:         "#fff",
          letterSpacing: "-0.5px",
          fontFamily:    "'Noto Sans KR', sans-serif",
          marginBottom:  8,
          textShadow:    "0 2px 12px rgba(0,0,0,0.15)",
        }}>
          Lin-K
        </div>
        <div style={{
          fontSize:   13,
          color:      "rgba(255,255,255,0.82)",
          fontFamily: "'Noto Sans KR', sans-serif",
          fontWeight: 500,
          marginBottom: 52,
        }}>
          서울 맞춤형 관광 동선 가이드
        </div>

        {/* ── 로딩 도트 인디케이터 */}
        <div style={{ display: "flex", gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width:           9,
                height:          9,
                borderRadius:    "50%",
                background:      "rgba(255,255,255,0.9)",
                animation:       `splash-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </div>

      </div>
    </>
  );
};

export default SplashScreen;