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

module.exports = { searchPlaces };