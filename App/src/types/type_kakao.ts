export type KakaoLatLng = { getLat: () => number; getLng: () => number };
export type KakaoLatLngBounds = { extend: (latlng: KakaoLatLng) => void };
export type KakaoMapInstance = {
  setCenter: (latlng: KakaoLatLng) => void;
  setLevel:  (level: number) => void;
  setBounds: (bounds: KakaoLatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number) => void;
};
export type KakaoOverlay  = { setMap: (map: KakaoMapInstance | null) => void };
export type KakaoCircle   = { setMap: (map: KakaoMapInstance | null) => void };
export type KakaoMarker   = { setMap: (map: KakaoMapInstance | null) => void };
export type KakaoPolyline = { setMap: (map: KakaoMapInstance | null) => void };
export type KakaoGeocoder = {
  addressSearch: (
    query:    string,
    callback: (result: Array<{ y: string; x: string; address_name: string }>, status: string) => void,
  ) => void;
};

export type KakaoPlaceSearchResult = {
  id:                string;
  place_name:        string;
  category_name:     string;
  address_name:      string;
  road_address_name: string;
  phone:             string;
  x:                 string;
  y:                 string;
  place_url:         string;
  distance:          string;
};

export type KakaoPlaces = {
  keywordSearch: (
    keyword:  string,
    callback: (result: KakaoPlaceSearchResult[], status: string) => void,
    options?: { location?: KakaoLatLng; radius?: number; size?: number },
  ) => void;
};
