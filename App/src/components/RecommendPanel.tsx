// ═══════════════════════════════════════════════════════════

// RecommendPanel — 추천 경로 패널

// [CHANGED] 경로 탐색 기능 통합
//   - 추천 장소들을 출발지~경유지~도착지로 설정
//   - 카카오 Directions API로 실제 경로 폴리라인 지도에 표시
//   - 거리/시간/요금/교통혼잡도 결과 카드 표시

// ═══════════════════════════════════════════════════════════

import { type FC, useState, useCallback, useMemo } from "react";
import type { Category, DirectionsResponse, RouteResult, Place } from "../types/type";
import type { RecommendedRoute, RecommendedPlace } from "../hooks/Userecommendedroute";
import PlaceMarker from "./PlaceMarker";
import type { KakaoMapInstance, KakaoOverlay, KakaoPolyline } from "../types/type_kakao";
import {
  COLOR_PRIMARY, COLOR_PRIMARY_LIGHT, COLOR_SURFACE,
  COLOR_BORDER, COLOR_BG, COLOR_TEXT_MAIN, COLOR_TEXT_SUB,
  COLOR_INACTIVE, COLOR_ORIGIN, COLOR_DEST, TRAFFIC_COLOR_MAP,
} from "../colors";
import { formatDistance, formatDuration } from "../utils/Utils";

// ── [CONFIG] ──────────────────────────────────────────────

const CATEGORY_ICON: Record<Category, string> = {
  카페: "☕", 갤러리: "🖼", 공원: "🌿", 명소: "📸", 문화: "🎨", 거리: "🛍",
};

const COLOR_CATEGORY: Record<Category, string> = {
  카페: "#b45309", 갤러리: "#7c3aed", 공원: "#16a34a",
  명소: "#1d4ed8",  문화: "#0e7490",  거리: "#be185d",
};

// ── [API] 추천 경유지 포함 실제 경로 조회 ─────────────────

const fetchRecommendRoute = async (
  places: RecommendedPlace[],
  userLat: number,
  userLng: number,
): Promise<RouteResult> => {
  if (places.length === 0) throw new Error("경유지가 없어요");

  const origin      = { lat: userLat, lng: userLng };
  const destination = places[places.length - 1];
  const waypoints   = places
    .slice(0, -1)
    .map(p => `${p.lng},${p.lat}`)
    .join("|");

  const params = new URLSearchParams({
    origin:      `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority:    "RECOMMEND",
    car_fuel:    "GASOLINE",
    car_hipass:  "false",
    alternatives:"false",
    road_details:"false",
    ...(waypoints ? { waypoints } : {}),
  });

  const res = await fetch(`${import.meta.env.VITE_KAKAO_DIRECTIONS_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${import.meta.env.VITE_KAKAO_REST_API_KEY}` },
  });

  if (!res.ok) throw new Error(`경로 API 오류: ${res.status}`);

  const data: DirectionsResponse = await res.json();
  const route = data.routes?.[0];
  if (!route || route.result_code !== 0) {
    throw new Error(route?.result_msg ?? "경로를 찾을 수 없어요");
  }

  const roads = route.sections.flatMap(s => s.roads);
  return {
    distanceMeter: route.summary.distance,
    durationSec:   route.summary.duration,
    taxiFare:      route.summary.fare.taxi,
    tollFare:      route.summary.fare.toll,
    roads,
  };
};

// ── [지도] 폴리라인 렌더링 ────────────────────────────────

const drawRouteOnMap = (
  result:      RouteResult,
  kakaoMapRef: React.MutableRefObject<KakaoMapInstance | null>,
  polylineListRef: React.MutableRefObject<KakaoPolyline[]>,
  overlayListRef:  React.MutableRefObject<KakaoOverlay[]>,
  places:      RecommendedPlace[],
) => {
  if (!kakaoMapRef.current) return;

  // 기존 레이어 정리
  polylineListRef.current.forEach(p => p.setMap(null));
  overlayListRef.current.forEach(o => o.setMap(null));
  polylineListRef.current = [];
  overlayListRef.current  = [];

  // 폴리라인 그리기
  result.roads.forEach(road => {
    const path: object[] = [];
    for (let i = 0; i < road.vertexes.length - 1; i += 2) {
      path.push(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
    }
    if (path.length < 2) return;
    const polyline = new window.kakao.maps.Polyline({
      map:           kakaoMapRef.current!,
      path,
      strokeWeight:  6,
      strokeColor:   TRAFFIC_COLOR_MAP[road.traffic_state] ?? TRAFFIC_COLOR_MAP[0],
      strokeOpacity: 0.9,
      strokeStyle:   "solid",
    });
    polylineListRef.current.push(polyline);
  });

  // 출발지 마커
  const makePin = (lat: number, lng: number, color: string, emoji: string, label: string) => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
    el.innerHTML = `
      <div style="background:#fff;border-radius:8px;padding:3px 8px;margin-bottom:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.12);font-size:11px;font-weight:700;border:1.5px solid ${color};font-family:'Noto Sans KR',sans-serif;">${label}</div>
      <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;">
        <span style="transform:rotate(45deg);font-size:12px;">${emoji}</span>
      </div>`;
    const overlay = new window.kakao.maps.CustomOverlay({
      map: kakaoMapRef.current!, content: el, yAnchor: 1.1, zIndex: 15,
      position: new window.kakao.maps.LatLng(lat, lng),
    });
    overlayListRef.current.push(overlay);
  };

  // 출발지·도착지는 PlaceMarker(React 컴포넌트)로 렌더링하므로 경유지만 처리
  places.slice(0, -1).forEach((p, i) => {
    makePin(p.lat, p.lng, COLOR_PRIMARY, `${i + 1}`, `${i + 1}. ${p.name}`);
  });

  // 지도 범위 자동 맞춤
  const bounds = new window.kakao.maps.LatLngBounds();
  result.roads.forEach(road => {
    for (let i = 0; i < road.vertexes.length - 1; i += 2) {
      bounds.extend(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
    }
  });
  kakaoMapRef.current!.setBounds(bounds, 60, 60, 60, 60);
};

// ── [COMPONENT] 경유지 카드 ───────────────────────────────

const PlaceStopCard: FC<{
  place:   RecommendedPlace;
  index:   number;
  isLast:  boolean;
  onClick: (place: RecommendedPlace) => void;
}> = ({ place, index, isLast, onClick }) => (
  <div style={{ display: "flex", gap: 12 }}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: COLOR_PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
        {index + 1}
      </div>
      {!isLast && <div style={{ width: 2, flex: 1, minHeight: 20, background: `${COLOR_PRIMARY}30`, marginTop: 4 }} />}
    </div>
    <div onClick={() => onClick(place)} style={{ flex: 1, marginBottom: isLast ? 0 : 12, background: COLOR_SURFACE, borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, padding: "10px 12px", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", transition: "all 0.18s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: `${COLOR_CATEGORY[place.category]}18`, color: COLOR_CATEGORY[place.category] }}>
          {CATEGORY_ICON[place.category]} {place.category}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place.name}</span>
      </div>
      <div style={{ display: "flex", gap: 8, fontSize: 11, color: COLOR_TEXT_SUB, alignItems: "center" }}>
        {place.rating > 0 && (
          <>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>★ {place.rating.toFixed(1)}</span>
            {place.reviews > 0 && <span>리뷰 {place.reviews.toLocaleString()}</span>}
            <span>·</span>
          </>
        )}
        <span style={{ color: COLOR_PRIMARY, fontWeight: 600 }}>{place.distance}m</span>
        {place.district && <><span>·</span><span>{place.district}</span></>}
      </div>
      {place.score > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: COLOR_TEXT_SUB }}>추천 점수</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: COLOR_PRIMARY }}>{place.score.toFixed(1)}점</span>
          </div>
          <div style={{ height: 3, background: COLOR_BG, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${COLOR_PRIMARY}, #60a5fa)`, width: `${Math.min(place.score / 8 * 100, 100)}%`, transition: "width 0.6s ease" }} />
          </div>
        </div>
      )}
    </div>
  </div>
);

// ── [COMPONENT] 경로 결과 카드 (RoutePanel과 동일한 UI) ────

const RouteResultCard: FC<{
  result:      RouteResult;
  places:      RecommendedPlace[];
  userLat:     number;
  userLng:     number;
}> = ({ result, places, userLat, userLng }) => (
  <div style={{ background: COLOR_SURFACE, borderRadius: 14, border: `1.5px solid ${COLOR_PRIMARY}`, overflow: "hidden", marginTop: 12 }}>
    {/* 요약 헤더 */}
    <div style={{ background: COLOR_PRIMARY_LIGHT, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 900, color: COLOR_PRIMARY }}>{formatDuration(result.durationSec)}</div>
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginTop: 2 }}>총 {formatDistance(result.distanceMeter)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        {result.taxiFare > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT_MAIN }}>🚕 {result.taxiFare.toLocaleString()}원</div>}
        {result.tollFare > 0 && <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, marginTop: 2 }}>통행료 {result.tollFare.toLocaleString()}원</div>}
      </div>
    </div>

    {/* 경유 목록 */}
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 출발 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLOR_ORIGIN, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: COLOR_TEXT_MAIN }}>현재 위치</div>
      </div>
      {places.map((p, i) => (
        <div key={p.id}>
          <div style={{ width: 2, height: 10, background: COLOR_BORDER, marginLeft: 3, marginBottom: 6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: i === places.length - 1 ? 2 : "50%", background: i === places.length - 1 ? COLOR_DEST : COLOR_PRIMARY, flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: COLOR_TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          </div>
        </div>
      ))}
    </div>

    {/* 교통 혼잡도 범례 */}
    <div style={{ padding: "8px 16px 14px", display: "flex", gap: 12, flexWrap: "wrap" }}>
      {([0, 1, 2, 3] as const).map(state => {
        const labels = ["원활", "서행", "정체", "매우정체"];
        return (
          <div key={state} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 20, height: 4, borderRadius: 2, background: TRAFFIC_COLOR_MAP[state] }} />
            <span style={{ fontSize: 10, color: COLOR_TEXT_SUB }}>{labels[state]}</span>
          </div>
        );
      })}
    </div>
  </div>
);

// ── [COMPONENT] 메인 패널 ─────────────────────────────────

interface RecommendPanelProps {
  route:        RecommendedRoute | null;
  isLoading:    boolean;
  error:        string | null;
  onRefetch:    () => void;
  onSelectPlace:(place: RecommendedPlace) => void;
  // 경로 탐색 기능용
  kakaoMapRef:     React.MutableRefObject<KakaoMapInstance | null>;
  polylineListRef: React.MutableRefObject<KakaoPolyline[]>;
  overlayListRef:  React.MutableRefObject<KakaoOverlay[]>;
  userLat:      number;
  userLng:      number;
}

const RecommendPanel: FC<RecommendPanelProps> = ({
  route, isLoading, error, onRefetch, onSelectPlace,
  kakaoMapRef, polylineListRef, overlayListRef,
  userLat, userLng,
}) => {
  const [routeResult,    setRouteResult]    = useState<RouteResult | null>(null);
  const [routeLoading,   setRouteLoading]   = useState<boolean>(false);
  const [routeError,     setRouteError]     = useState<string | null>(null);
  const [routeDrawn,     setRouteDrawn]     = useState<boolean>(false);

  const originPlace = useMemo<Place>(() => ({
    id: -1, name: "출발", category: "명소", rating: 0, reviews: 0,
    district: "", lat: userLat, lng: userLng, distance: 0,
  }), [userLat, userLng]);

  // 경로 탐색 실행
  const handleDrawRoute = useCallback(async () => {
    if (!route) return;
    setRouteLoading(true);
    setRouteError(null);
    setRouteResult(null);
    setRouteDrawn(false);
    try {
      const result = await fetchRecommendRoute(route.places, userLat, userLng);
      setRouteResult(result);
      drawRouteOnMap(result, kakaoMapRef, polylineListRef, overlayListRef, route.places);
      setRouteDrawn(true);
    } catch (e) {
      setRouteError((e as Error).message);
    } finally {
      setRouteLoading(false);
    }
  }, [route, userLat, userLng, kakaoMapRef, polylineListRef, overlayListRef]);

  // 경로 초기화
  const handleClearRoute = useCallback(() => {
    polylineListRef.current.forEach(p => p.setMap(null));
    overlayListRef.current.forEach(o => o.setMap(null));
    polylineListRef.current = [];
    overlayListRef.current  = [];
    setRouteResult(null);
    setRouteDrawn(false);
    setRouteError(null);
  }, [polylineListRef, overlayListRef]);

  // 재추천 시 경로도 초기화
  const handleRefetch = useCallback(() => {
    handleClearRoute();
    onRefetch();
  }, [handleClearRoute, onRefetch]);

  // ── 로딩
  if (isLoading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "48px 24px" }}>
      <div style={{ position: "relative", width: 48, height: 48 }}>
        <div style={{ position: "absolute", inset: 0, border: `3px solid ${COLOR_PRIMARY}20`, borderRadius: "50%" }} />
        <div style={{ position: "absolute", inset: 0, border: `3px solid ${COLOR_PRIMARY}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLOR_TEXT_MAIN, marginBottom: 4 }}>최적 경로 분석 중</div>
        <div style={{ fontSize: 12, color: COLOR_TEXT_SUB }}>주변 장소 평점을 수집하고 있어요</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  // ── 에러
  if (error) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 24px" }}>
      <span style={{ fontSize: 36 }}>⚠️</span>
      <span style={{ fontSize: 13, color: "#e53e3e", textAlign: "center" }}>{error}</span>
      <button onClick={handleRefetch} style={{ padding: "9px 20px", borderRadius: 10, border: `1.5px solid ${COLOR_PRIMARY}`, background: "transparent", color: COLOR_PRIMARY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}>다시 시도</button>
    </div>
  );

  if (!route) return (
    <div style={{ textAlign: "center", color: COLOR_INACTIVE, fontSize: 13, padding: "48px 24px" }}>
      추천 경로를 불러오는 중이에요
    </div>
  );

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      {routeDrawn && route && (
        <>
          <PlaceMarker
            place={originPlace}
            isSelected isActive isDeemphasized={false}
            kakaoMapRef={kakaoMapRef}
            onSelectPlace={() => {}}
            pinColor="#16a34a"
            hideCategoryIcon
          />
          <PlaceMarker
            place={route.places[route.places.length - 1]}
            isSelected isActive isDeemphasized={false}
            kakaoMapRef={kakaoMapRef}
            onSelectPlace={(p) => { if (p) onSelectPlace(p as RecommendedPlace); }}
            pinColor={COLOR_DEST}
            hideCategoryIcon
          />
        </>
      )}

      {/* 요약 헤더 */}
      <div style={{ background: COLOR_PRIMARY_LIGHT, borderRadius: 14, padding: "14px 16px", marginBottom: 16, border: `1.5px solid ${COLOR_PRIMARY}30`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, fontWeight: 600, marginBottom: 3 }}>🗺 AI 추천 코스 · {route.places.length}곳</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: COLOR_PRIMARY }}>
            {route.totalDuration > 0 ? formatDuration(route.totalDuration) : `${route.places.length}개 장소`}
          </div>
          {route.totalDistance > 0 && (
            <div style={{ fontSize: 12, color: COLOR_TEXT_SUB, marginTop: 2 }}>총 {formatDistance(route.totalDistance)}</div>
          )}
        </div>
        <button onClick={handleRefetch} style={{ background: "none", border: `1px solid ${COLOR_PRIMARY}40`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13, color: COLOR_PRIMARY, fontFamily: "'Noto Sans KR', sans-serif" }}>
          🔄 재추천
        </button>
      </div>

      {/* 추천 기준 배지 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {["⭐ 평점 우선", "📍 거리 고려", "🎨 카테고리 다양성"].map(label => (
          <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: COLOR_BG, color: COLOR_TEXT_SUB, border: `1px solid ${COLOR_BORDER}` }}>{label}</span>
        ))}
      </div>

      {/* 경유지 목록 */}
      <div style={{ marginBottom: 16 }}>
        {route.places.map((place, i) => (
          <PlaceStopCard key={place.id} place={place} index={i} isLast={i === route.places.length - 1} onClick={onSelectPlace} />
        ))}
      </div>

      {/* 경로 탐색 버튼 */}
      {!routeDrawn && (
        <button
          onClick={handleDrawRoute}
          disabled={routeLoading}
          style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "none", background: routeLoading ? COLOR_INACTIVE : COLOR_PRIMARY, color: "#fff", fontSize: 14, fontWeight: 700, cursor: routeLoading ? "default" : "pointer", fontFamily: "'Noto Sans KR', sans-serif", transition: "all 0.18s" }}
        >
          {routeLoading ? "경로 계산 중..." : "🗺 이 경로로 길 찾기"}
        </button>
      )}

      {/* 경로 초기화 버튼 */}
      {routeDrawn && (
        <button
          onClick={handleClearRoute}
          style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: `1.5px solid ${COLOR_BORDER}`, background: COLOR_SURFACE, color: COLOR_TEXT_SUB, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif" }}
        >
          ✕ 경로 지우기
        </button>
      )}

      {/* 경로 에러 */}
      {routeError && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#e53e3e", fontWeight: 600, textAlign: "center" }}>{routeError}</div>
      )}

      {/* 경로 결과 카드 */}
      {routeResult && (
        <RouteResultCard result={routeResult} places={route.places} userLat={userLat} userLng={userLng} />
      )}

      {/* 안내 문구 */}
      <div style={{ marginTop: 16, padding: "10px 14px", background: COLOR_BG, borderRadius: 10, border: `1px solid ${COLOR_BORDER}` }}>
        <div style={{ fontSize: 11, color: COLOR_TEXT_SUB, lineHeight: 1.6 }}>
          💡 장소를 탭하면 지도에서 위치를 확인할 수 있어요.<br />
          평점은 Tripadvisor 기준이며, 매칭되지 않은 장소는 점수 없이 표시돼요.
        </div>
      </div>
    </div>
  );
};

export default RecommendPanel;
