// ═══════════════════════════════════════════════════════════
// RouteMap — 경로 탐색 결과를 지도에 렌더링하는 헤드리스 컴포넌트
//
// [구조]
//   - DOM 노드를 반환하지 않고 카카오 지도 오버레이만 제어
//   - routeState 변경 시 기존 폴리라인 제거 후 재렌더링
//
// [폴리라인]
//   - API 응답 roads의 vertexes([lng, lat, ...] 쌍)를 파싱
//   - traffic_state 값에 따라 TRAFFIC_COLOR_MAP 색상 적용
//
// [지도 범위 자동 맞춤]
//   result 있음   — 전체 road 좌표로 bounds 계산 (padding 60px)
//   result 없음   — origin + destination 두 점으로 bounds 계산
//   origin만 있음 — 해당 좌표로 지도 중심 이동
//
// [Props]
//   routeState  — 출발지/도착지/결과/로딩 상태를 담은 RouteState
//   kakaoMapRef — 카카오 지도 인스턴스 ref
//   isMapReady  — 지도 초기화 완료 여부
// ═══════════════════════════════════════════════════════════

import { type FC, useEffect, useRef } from "react";
import type { RouteState } from "../types/type";
import type { KakaoLatLng, KakaoMapInstance, KakaoPolyline } from "../types/type_kakao";
import { TRAFFIC_COLOR_MAP } from "../colors";


interface RouteMapProps {
  routeState:  RouteState;
  kakaoMapRef: React.MutableRefObject<KakaoMapInstance | null>;
  isMapReady:  boolean;
}

const RouteMap: FC<RouteMapProps> = ({ routeState, kakaoMapRef, isMapReady }) => {
  const polylineListRef = useRef<KakaoPolyline[]>([]);

  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current) return;

    // 기존 레이어 정리
    polylineListRef.current.forEach(p => p.setMap(null));
    polylineListRef.current = [];

    const { origin, destination, result } = routeState;



    // [RENDER] API 응답 roads의 vertexes로 교통 혼잡도별 폴리라인 그리기
    // vertexes 포맷: [lng0, lat0, lng1, lat1, ...] — 2개씩 쌍으로 파싱
    if (result) {
      result.roads.forEach(road => {
        const { vertexes, traffic_state } = road;
        const path: KakaoLatLng[] = [];
        for (let i = 0; i < vertexes.length - 1; i += 2) {
          path.push(new window.kakao.maps.LatLng(vertexes[i + 1], vertexes[i]));
        }
        if (path.length < 2) return;

        const polyline = new window.kakao.maps.Polyline({
          map:           kakaoMapRef.current!,
          path,
          strokeWeight:  6,
          strokeColor:   TRAFFIC_COLOR_MAP[traffic_state] ?? TRAFFIC_COLOR_MAP[0],
          strokeOpacity: 0.9,
          strokeStyle:   "solid",
        });
        polylineListRef.current.push(polyline);
      });

      // [NOTE] API 응답의 전체 좌표로 지도 범위 자동 맞춤 (padding 60px)
      const bounds = new window.kakao.maps.LatLngBounds();
      result.roads.forEach(road => {
        for (let i = 0; i < road.vertexes.length - 1; i += 2) {
          bounds.extend(new window.kakao.maps.LatLng(road.vertexes[i + 1], road.vertexes[i]));
        }
      });
      kakaoMapRef.current!.setBounds(bounds, 60, 60, 60, 60);

    } else if (origin && destination) {
      // [NOTE] 결과 없을 때 두 점만으로 범위 맞춤
      const bounds = new window.kakao.maps.LatLngBounds();
      bounds.extend(new window.kakao.maps.LatLng(origin.lat, origin.lng));
      bounds.extend(new window.kakao.maps.LatLng(destination.lat, destination.lng));
      kakaoMapRef.current!.setBounds(bounds, 60, 60, 60, 60);
    } else if (origin) {
      kakaoMapRef.current!.setCenter(new window.kakao.maps.LatLng(origin.lat, origin.lng));
    } else if (destination) {
      kakaoMapRef.current!.setCenter(new window.kakao.maps.LatLng(destination.lat, destination.lng));
    }
  }, [isMapReady, routeState, kakaoMapRef]);

  return null;
};

export default RouteMap;