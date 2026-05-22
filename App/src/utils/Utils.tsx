import type { Place, PlaceData, Category } from "../types/type";
import type { KakaoPlaceSearchResult } from "../types/type_kakao";

const mapKakaoCategory = (categoryName: string): Category => {
  if (categoryName.includes("카페"))                              return "카페";
  if (categoryName.includes("갤러리") || categoryName.includes("미술")) return "갤러리";
  if (categoryName.includes("공원"))                             return "공원";
  if (categoryName.includes("문화"))                             return "문화";
  if (categoryName.includes("거리") || categoryName.includes("쇼핑")) return "거리";
  return "명소";
};

export const kakaoResultToPlace = (result: KakaoPlaceSearchResult): Place => ({
  id:       Number(result.id),
  name:     result.place_name,
  category: mapKakaoCategory(result.category_name),
  rating:   0,
  reviews:  0,
  district: result.address_name,
  lat:      Number(result.y),
  lng:      Number(result.x),
  distance: Number(result.distance),
});

/* 두 지점 간의 거리 계산 (Haversine 공식) */
export const calcDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/* PlaceData를 Place로 변환 (사용자 위치 기반) */
export const toPlace = (placeData: PlaceData, userLat: number, userLng: number): Place => ({
  id: placeData.id, name: placeData.name, category: placeData.category,
  rating: placeData.rating, reviews: placeData.reviews, district: placeData.district,
  lat: userLat + placeData.latOffset, lng: userLng + placeData.lngOffset,
  distance: calcDistance(userLat, userLng, userLat + placeData.latOffset, userLng + placeData.lngOffset),
});

/* 초 → "N시간 M분" 또는 "M분" 포맷 */
export const formatDuration = (sec: number): string => {
  const min = Math.ceil(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`;
};

/* 미터 → "N.Nkm" 또는 "Nm" 포맷 */
export const formatDistance = (meter: number): string =>
  meter >= 1000 ? `${(meter / 1000).toFixed(1)}km` : `${meter}m`;