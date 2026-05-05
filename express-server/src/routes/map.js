const express = require('express');
const router = express.Router();
const Kakao_Service = require('../services/Kakao_Service');
const TripAdvisorService = require('../services/TripAdvisor_Service');

router.get('/search', async (req, res) => {
    try {
        const query = req.query.query; // 브라우저에서 보낸 ?query=강남역 추출
        if (!query) return res.status(400).send('검색어를 입력하세요.');

        const results = await Kakao_Service.searchPlaces(query);
        res.json(results);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 외국인 관광객 맞춤형 장소 탐색 API 라우트
router.get('/search-places', async (req, res) => {
    // 1. 요청이 제대로 들어왔는지 확인하는 로그 (추가)
    try {
        const { keyword, targetLang } = req.query;

        if (!keyword) {
            return res.status(400).json({ error: '검색어(keyword)가 필요합니다.' });
        }

        const language = targetLang || 'en'; 
        
        // 1. 먼저 키워드로 장소 리스트(기본 정보)를 검색합니다.
        const searchResult = await TripAdvisorService.searchLocation(keyword, language);

        if (!searchResult.data || searchResult.data.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // 💡 팁: API 호출 횟수를 아끼기 위해 상위 5개만 상세 정보를 가져오도록 자릅니다.
        // TripAdvisor API는 호출 횟수에 따라 과금이 될 수 있으므로 제한을 두는 것이 좋습니다.
        const topPlaces = searchResult.data.slice(0, 5); 

        // 2. 검색된 장소들의 location_id를 이용해 평점과 리뷰 수를 병렬로 가져와 합칩니다.
        const placesWithDetails = await Promise.all(
            topPlaces.map(async (place) => {
                const details = await TripAdvisorService.getLocationDetails(place.location_id, language);
                
                return {
                    ...place, // 기존 데이터 (id, name, address 등)
                    rating: details?.rating || '평점 없음',          // 추가된 평점
                    num_reviews: details?.num_reviews || '0',        // 추가된 리뷰 수
                    web_url: details?.web_url || ''                  // (보너스) 트립어드바이저 링크
                };
            })
        );

        res.json({
            success: true,
            data: placesWithDetails
        });

    } catch (error) {
        console.error('🚨 라우터 에러:', error);
        res.status(500).json({ error: '장소 데이터를 가져오는 데 실패했습니다.' });
    }
});

module.exports = router;