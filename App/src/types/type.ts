export type Tab = "nearby" | "route" | "favorites";
export type TransportMode = "car" | "walk" | "transit";
export type Category = "카페" | "갤러리" | "공원" | "명소" | "문화" | "거리" | "식당";

export type PlaceData = {
  id:        number;
  name:      string;
  category:  Category;
  rating:    number;
  reviews:   number;
  district:  string;
  latOffset: number;
  lngOffset: number;
};

export type Place = Omit<PlaceData, "latOffset" | "lngOffset"> & {
  lat:      number;
  lng:      number;
  distance: number;
  address?: string; // 도로명/지번 전체 주소
};

export type UserLocation = {
  lat:        number;
  lng:        number;
  isLocating: boolean;
  locLabel:   string;
};

export type RoutePoint = {
  label: string;
  lat:   number;
  lng:   number;
};

// [API] 카카오모빌리티 Directions API 응답 타입
export type DirectionsRoad = {
  name:          string;
  distance:      number;
  duration:      number;
  traffic_speed: number;
  traffic_state: number;
  vertexes:      number[]; // [lng, lat, lng, lat, ...] 쌍으로 구성
};

export type DirectionsSection = {
  distance: number;
  duration: number;
  roads:    DirectionsRoad[];
};

export type DirectionsSummary = {
  distance: number; // 총 거리 (m)
  duration: number; // 총 소요 시간 (초)
  fare: {
    taxi: number; // 택시 요금 (원)
    toll: number; // 통행 요금 (원)
  };
};

export type DirectionsRoute = {
  result_code: number;
  result_msg:  string;
  summary:     DirectionsSummary;
  sections:    DirectionsSection[];
};

export type DirectionsResponse = {
  routes: DirectionsRoute[];
};

export type RouteResult = {
  distanceMeter: number;    // 총 거리 (m)
  durationSec:   number;    // 총 소요시간 (초)
  taxiFare:      number;    // 택시 요금 (원)
  tollFare:      number;    // 통행 요금 (원)
  roads:         DirectionsRoad[]; // 교통 상태 포함 도로 목록
};

export type RouteState = {
  origin:      RoutePoint | null;
  destination: RoutePoint | null;
  result:      RouteResult | null;
  isLoading:   boolean;
  errorMsg:    string;
};