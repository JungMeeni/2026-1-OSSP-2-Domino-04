// ═══════════════════════════════════════════════════════════
// PlaceCard — 장소 목록 아이템 카드 컴포넌트
//
// [구조]
//   - 카테고리 아이콘 + 장소명 + 평점 / 리뷰 수 / 거리 표시
//   - isSelected 시 강조 스타일 (배경색·테두리 변경)
//
// [Props]
//   place      — 표시할 장소 데이터
//   isSelected — 선택 여부 (강조 스타일 적용)
//   onSelect   — 카드 클릭 시 호출되는 콜백
// ═══════════════════════════════════════════════════════════

import { type FC } from "react";
import type { Place, Category } from "../types/type";
import { COLOR_PRIMARY, COLOR_PRIMARY_LIGHT, COLOR_SURFACE, COLOR_BORDER, COLOR_BG, COLOR_TEXT_MAIN, COLOR_TEXT_SUB } from "../colors";

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍", 식당: "🍽️"
};

interface PlaceCardProps {
  place:      Place;
  isSelected: boolean;
  onSelect:   (place: Place) => void;
}

const PlaceCard: FC<PlaceCardProps> = ({ place, isSelected, onSelect }) => (
  <div onClick={() => onSelect(place)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 14, background: isSelected ? COLOR_PRIMARY_LIGHT : COLOR_SURFACE, border: `1.5px solid ${isSelected ? COLOR_PRIMARY : COLOR_BORDER}`, boxShadow: isSelected ? "0 2px 12px rgba(26,107,255,0.12)" : "0 1px 4px rgba(0,0,0,0.05)", cursor: "pointer", transition: "all 0.2s" }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: isSelected ? `${COLOR_PRIMARY}18` : COLOR_BG, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
      {CATEGORY_ICON[place.category] ?? "📍"}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place.name}</div>
      <div style={{ display: "flex", gap: 8, fontSize: 11, color: COLOR_TEXT_SUB }}>
        {place.rating > 0 && <><span>⭐ {place.rating.toFixed(1)}</span><span>·</span></>}
        {place.reviews > 0 && <><span>리뷰 {place.reviews.toLocaleString()}</span><span>·</span></>}
        <span style={{ color: COLOR_PRIMARY, fontWeight: 600 }}>{place.distance}m</span>
      </div>
    </div>
  </div>
);

export default PlaceCard;