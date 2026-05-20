const axios = require('axios');

const searchPlaces = async (query) => {
    const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
    const url = 'https://dapi.kakao.com/v2/local/search/keyword.json';
    
    console.time('⏱️ 카카오 API 호출 시간');

    try {
        const response = await axios.get(url, {
            params: { query },
            headers: { 'Authorization': `KakaoAK ${KAKAO_KEY}` },
            timeout: 5000 // 서버 지연에 대비한 타임아웃 추가 (5초)
        });

        return response.data.documents;
    } catch (error) {
        // 에러가 발생해도 로그 상에서 타이머는 종료해주는 것이 좋습니다.
        const errorMessage = error.response ? error.response.data : error.message;
        console.error("❌ 카카오 API 에러 상세:", errorMessage);
        throw new Error("카카오 API 호출 중 문제가 발생했습니다.");
    } finally {
        console.timeEnd('⏱️ 카카오 API 호출 시간'); // 성공/실패 여부와 상관없이 항상 종료
    }
};

// 2. 특정 좌표 주변의 카테고리(카페, 식당 등) 검색
const getPlacesByCategory = async (categoryCode, x, y, radius = 1000) => {
    const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
    const url = 'https://dapi.kakao.com/v2/local/search/category.json';

    console.time(`⏱️ 카카오 API 카테고리(${categoryCode}) 호출 시간`); 

    try {
        const response = await axios.get(url, {
            params: {
                category_group_code: categoryCode,
                x: x, // 경도 (lng)
                y: y, // 위도 (lat)
                radius: radius,
                sort: 'distance' // 거리순 정렬
            },
            headers: { 'Authorization': `KakaoAK ${KAKAO_KEY}` },
            timeout: 5000 // 기존 코드처럼 타임아웃 5초 적용
        });

        // 백엔드에서 필요한 데이터만 쏙 뽑아서 깔끔하게 배열로 반환
        return response.data.documents.map(place => ({
            id: place.id,
            name: place.place_name,
            address: place.road_address_name || place.address_name,
            lat: place.y, // 카카오 API는 y가 위도
            lng: place.x, // 카카오 API는 x가 경도
            url: place.place_url
        }));
    } catch (error) {
        const errorMessage = error.response ? error.response.data : error.message;
        console.error(`❌ 카카오 API(${categoryCode}) 검색 에러 상세:`, errorMessage);
        throw new Error("카카오 카테고리 검색 중 문제가 발생했습니다.");
    } finally {
        console.timeEnd(`⏱️ 카카오 API 카테고리(${categoryCode}) 호출 시간`);
    }
};

/**
 * 카카오 Directions API 대리 호출 (Proxy 서비스)
 * @param {Object} queryParams - 프론트엔드에서 전달받은 쿼리 파라미터 객체 (origin, destination 등 포함)
 * @returns {Promise<Object>} 카카오 API 서버의 원본 응답 데이터
 */
async function getDirections(queryParams) {
    try {
        // 백엔드 .env에 등록된 KAKAO_DIRECTIONS_URL과 KAKAO_REST_API_KEY 사용
        const response = await axios.get(process.env.KAKAO_DIRECTIONS_URL, {
            params: queryParams, // 가공 없이 프론트에서 받은 값을 그대로 카카오에 전달
            headers: {
                // 명세서 요구사항: 헤더에 Authorization 추가
                'Authorization': `KakaoAK ${process.env.KAKAO_REST_API_KEY}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('🚨 Kakao_Service getDirections 에러:', error.message);
        throw error;
    }
}

// 두 함수를 모두 사용할 수 있게 export
module.exports = { searchPlaces, getPlacesByCategory, getDirections };