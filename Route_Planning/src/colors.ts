// ═══════════════════════════════════════════════════════════
// colors.ts — 앱 전역 색상 상수
// [THEME] 주황색 베이스 (PANTONE 144 C 계열)
// ═══════════════════════════════════════════════════════════

// [THEME] 메인 컬러 — 주황색 (PANTONE 144 C 기준, 약간 밝게 조정)
export const COLOR_PRIMARY        = "#F59A00";  // 주황색 메인
export const COLOR_PRIMARY_LIGHT  = "#FEF3DC";  // 주황색 연한 배경
export const COLOR_PRIMARY_DARK   = "#D98200";  // 주황색 진한 (hover, 강조)

// [THEME] 배경 / 서피스
export const COLOR_BG             = "#F8F9FA";  // 앱 배경
export const COLOR_SURFACE        = "#FFFFFF";  // 카드, 시트 등 서피스
export const COLOR_BORDER         = "#EAECEF";  // 경계선

// [THEME] 텍스트
export const COLOR_TEXT_MAIN      = "#1A1D23";  // 본문 텍스트
export const COLOR_TEXT_SUB       = "#7A8394";  // 보조 텍스트

// [THEME] 상태 색상
export const COLOR_INACTIVE       = "#C2C8D4";  // 비활성
export const COLOR_DANGER         = "#E03E3E";  // 에러 / 경고

// [THEME] 지도 핀 색상
export const COLOR_ORIGIN         = "#F59A00";  // 출발지 핀 (= PRIMARY)
export const COLOR_DEST           = "#E03E3E";  // 도착지 핀

// [THEME] 교통 혼잡도 색상 (카카오모빌리티 traffic_state 기준)
// 0: 원활, 1: 서행, 2: 정체, 3: 매우정체
export const TRAFFIC_COLOR_MAP: Record<number, string> = {
  0: "#4CAF7D",  // 원활 — 초록
  1: "#F59A00",  // 서행 — 동국 오렌지
  2: "#F06A00",  // 정체 — 진한 오렌지
  3: "#E03E3E",  // 매우정체 — 빨강
};