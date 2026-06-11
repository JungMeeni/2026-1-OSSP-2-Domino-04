import { useState, useEffect, type FC } from "react";
import type { Place, Category } from "../types/type";
import {
  COLOR_PRIMARY, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_BORDER, COLOR_BG, COLOR_SURFACE, COLOR_INACTIVE,
} from "../colors";
import {
  fetchTaLocationId,
  fetchTaFullDetail,
  haversineM,
  type TaFullDetail,
} from "../hooks/Usekakaonearby";

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍", 식당: "🍽️",
};

const CATEGORY_EN: Record<Category, string> = {
  카페: "Café", 갤러리: "Gallery", 공원: "Park", 명소: "Landmark", 문화: "Culture", 거리: "Street", 식당: "Restaurant",
};

const L = (ko: string, en: string, isEn: boolean) => isEn ? en : ko;

const StarRating: FC<{ rating: number }> = ({ rating }) => (
  <span style={{ letterSpacing: 1 }}>
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} style={{ color: rating >= i ? COLOR_PRIMARY : COLOR_INACTIVE, fontSize: 16 }}>
        {rating >= i ? "★" : "☆"}
      </span>
    ))}
  </span>
);

const InfoRow: FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
    <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
    <div>
      <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: COLOR_TEXT_MAIN, wordBreak: "break-word", lineHeight: 1.5 }}>
        {value}
      </div>
    </div>
  </div>
);

const isSamePlace = (place: Place, detail: TaFullDetail): boolean => {
  if (!detail.latitude || !detail.longitude) return true;
  const taLat = parseFloat(detail.latitude);
  const taLng = parseFloat(detail.longitude);
  if (isNaN(taLat) || isNaN(taLng)) return true;
  return haversineM(place.lat, place.lng, taLat, taLng) < 500;
};

interface PlaceDetailPanelProps {
  place:              Place;
  onClose:            () => void;
  isFavorited?:       boolean;
  onToggleFavorite?:  () => void;
  isEn?:              boolean;
}

const PlaceDetailPanel: FC<PlaceDetailPanelProps> = ({
  place, onClose, isFavorited = false, onToggleFavorite, isEn = false,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [detail,    setDetail]    = useState<TaFullDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setDetail(null);

    const lang = isEn ? "en" : "ko";

    (async () => {
      // 위치 ID 검색은 항상 ko — 카카오 한국어 이름 매칭 정확도를 위해
      const locationId = await fetchTaLocationId(place.name, place.lat, place.lng, "ko");
      if (cancelled) return;
      if (locationId) {
        // 콘텐츠(설명·영문이름 등)는 사용자 언어로 요청
        const det = await fetchTaFullDetail(locationId, lang);
        if (cancelled) return;
        if (det && isSamePlace(place, det)) setDetail(det);
      }
      setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [place.id, place.name, place.lat, place.lng, isEn]);

  const catIcon    = CATEGORY_ICON[place.category] ?? "📍";
  const categoryFallback = isEn ? (CATEGORY_EN[place.category] ?? place.category) : place.category;
  const themeLabel = [
    detail?.category?.localized_name,
    ...(detail?.subcategory?.map(s => s.localized_name).filter(Boolean) ?? []),
  ].filter(Boolean).join(" · ") || categoryFallback;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      background: COLOR_BG,
      display: "flex", flexDirection: "column",
      fontFamily: "'Noto Sans KR', sans-serif",
    }}>

      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "14px 12px",
        borderBottom: `1px solid ${COLOR_BORDER}`,
        background: COLOR_SURFACE,
        flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 8, color: COLOR_TEXT_SUB, fontSize: 20, lineHeight: 1, flexShrink: 0 }}>
          ←
        </button>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{catIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLOR_TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(isEn && detail?.name) ? detail.name : place.name}
          </div>
          <div style={{ fontSize: 11, color: COLOR_TEXT_SUB }}>{themeLabel}</div>
        </div>

        {/* 즐겨찾기 버튼 */}
        {onToggleFavorite && (
          <button
            onClick={onToggleFavorite}
            title={isFavorited ? (isEn ? "Remove from favorites" : "즐겨찾기 해제") : (isEn ? "Add to favorites" : "즐겨찾기 추가")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "4px 2px", fontSize: 22, lineHeight: 1, flexShrink: 0,
              color: isFavorited ? "#f59e0b" : COLOR_INACTIVE,
              transition: "color 0.15s",
            }}
          >
            {isFavorited ? "★" : "☆"}
          </button>
        )}
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 18px 24px" }}>

        {/* 평점 블록 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 18, padding: "12px 14px",
          background: COLOR_SURFACE, borderRadius: 12,
          border: `1px solid ${COLOR_BORDER}`,
        }}>
          {place.rating > 0 ? (
            <>
              <StarRating rating={Math.round(place.rating)} />
              <span style={{ fontSize: 17, fontWeight: 700, color: COLOR_TEXT_MAIN }}>
                {place.rating.toFixed(1)}
              </span>
              {place.reviews > 0 && (
                <span style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>
                  · {L("후기", "reviews", isEn)} {place.reviews.toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 13, color: COLOR_TEXT_SUB }}>
              {L("평점 정보 없음", "No rating", isEn)}
            </span>
          )}
        </div>

        {/* 로딩 */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: COLOR_TEXT_SUB, fontSize: 13 }}>
            {L("정보를 불러오는 중...", "Loading...", isEn)}
          </div>
        ) : (
          <>
            {/* 랭킹 */}
            {detail?.ranking_data?.ranking_string && (
              <div style={{ marginBottom: 16, padding: "10px 12px", background: `${COLOR_PRIMARY}14`, borderRadius: 10 }}>
                <span style={{ fontSize: 12, color: COLOR_PRIMARY, fontWeight: 600 }}>
                  🏆 {detail.ranking_data.ranking_string}
                </span>
              </div>
            )}

            {/* 주소 */}
            {(place.address || place.district || detail?.address_obj?.address_string) && (
              <InfoRow
                icon="📍"
                label={L("주소", "Address", isEn)}
                value={place.address || place.district || detail!.address_obj!.address_string!}
              />
            )}

            {/* 테마 */}
            <InfoRow icon="🏷" label={L("테마", "Category", isEn)} value={themeLabel} />

            {/* 가격대 */}
            {detail?.price_level && (
              <InfoRow icon="💰" label={L("가격대", "Price", isEn)} value={detail.price_level} />
            )}

            {/* 영업 시간 */}
            {detail?.hours?.weekday_text && detail.hours.weekday_text.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>🕐</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginBottom: 6 }}>
                      {L("영업 시간", "Hours", isEn)}
                    </div>
                    <div style={{ background: COLOR_SURFACE, borderRadius: 10, border: `1px solid ${COLOR_BORDER}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
                      {detail.hours.weekday_text.map((line, i) => (
                        <div key={i} style={{ fontSize: 12, color: COLOR_TEXT_MAIN }}>{line}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 설명 */}
            {detail?.description && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>📝</span>
                  <div>
                    <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginBottom: 4 }}>
                      {L("소개", "About", isEn)}
                    </div>
                    <div style={{ fontSize: 13, color: COLOR_TEXT_MAIN, lineHeight: 1.7, background: COLOR_SURFACE, borderRadius: 10, border: `1px solid ${COLOR_BORDER}`, padding: "10px 12px" }}>
                      {detail.description}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TripAdvisor 링크 */}
            {detail?.web_url && (
              <a
                href={detail.web_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  marginTop: 8, padding: "11px 0",
                  background: "#00aa6c", borderRadius: 12,
                  color: "#fff", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10"/><path fill="#00aa6c" d="M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
                  <circle cx="12" cy="12" r="2" fill="#fff"/>
                </svg>
                {L("TripAdvisor에서 보기", "View on TripAdvisor", isEn)}
              </a>
            )}

            {/* 지도 링크 — TripAdvisor 없을 때 */}
            {!detail?.web_url && (
              <>
                {!detail && (
                  <div style={{ textAlign: "center", padding: "12px 0 8px", color: COLOR_TEXT_SUB, fontSize: 13 }}>
                    {L("추가 정보가 없습니다", "No additional info", isEn)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <a
                    href={`https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", background: "#FFCE00", borderRadius: 12, color: "#3C1E1E", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
                  >
                    {L("카카오맵에서 보기", "Kakao Maps", isEn)}
                  </a>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&center=${place.lat},${place.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 0", background: "#4285F4", borderRadius: 12, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
                  >
                    {L("구글 지도", "Google Maps", isEn)}
                  </a>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PlaceDetailPanel;
