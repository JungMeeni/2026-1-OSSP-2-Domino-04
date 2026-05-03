const axios = require('axios'); // 프로젝트에 없다면 npm install axios 필요

// .env에 저장해둔 키를 가져옵니다.
const TRIPADVISOR_KEY = process.env.TRIPADVISOR_API_KEY; 
const BASE_URL = 'https://api.content.tripadvisor.com/api/v1/location/search';

/**
 * TripAdvisor Location Search API 호출
 * @param {string} query - 검색할 장소 이름
 * @param {string} language - 다국어 지원 파라미터 (내국인: 'ko', 외국인: 'en' 등)
 */
const searchLocation = async (query, language = 'en') => {
    try {
        const response = await axios.get(BASE_URL, {
            params: {
                key: TRIPADVISOR_KEY,
                searchQuery: query,
                language: language,      // 기획안의 내/외국인 구분 로직을 처리하는 핵심 파라미터
                category: 'attractions', // 관광지 추천이 목적이라면 'attractions', 식당 포함시 'restaurants' 등 변경 가능
            },
            headers: {
                'accept': 'application/json'
            }
        });
        
        // TripAdvisor API는 응답 객체 내부에 data 배열 형태로 결과를 반환합니다.
        return response.data;
    } catch (error) {
        console.error('TripAdvisor API 통신 에러:', error.response?.data || error.message);
        throw error;
    }
};

const getLocationDetails = async (locationId, language = 'en') => {
    const DETAILS_URL = `https://api.content.tripadvisor.com/api/v1/location/${locationId}/details`;
    try {
        const response = await axios.get(DETAILS_URL, {
            params: {
                key: TRIPADVISOR_KEY,
                language: language
            },
            headers: { 'accept': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error(`Location Details API 에러 (ID: ${locationId}):`, error.message);
        return null; // 특정 장소 디테일 호출이 실패해도 전체 로직이 터지지 않도록 null 반환
    }
};

module.exports = {
    searchLocation,
    getLocationDetails
};