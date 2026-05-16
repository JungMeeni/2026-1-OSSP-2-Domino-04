const express = require('express');
const router = express.Router();
const { searchPlaces, getPlacesByCategory } = require('../services/Kakao_Service');
const TripAdvisorService = require('../services/TripAdvisor_Service');

/*
#swagger.tags = ['Map (지도 관련 API)']
#swagger.summary = '근처 인기 장소 추천'
#swagger.description = '사용자의 현재 GPS(위도, 경도)를 받아 도보 10분(500m) 이내의 인기 장소를 TripAdvisor 평점 기준으로 추천합니다.'

#swagger.tags: API들을 그룹으로 묶어주는 폴더 같은 역할입니다. (예: 인증, 지도, 재난 등)
#swagger.summary: 리스트에 보이는 짧은 제목입니다.
#swagger.description: 클릭했을 때 펼쳐지는 상세 설명입니다.
*/

router.get('/search', async (req, res) => {
    /* #swagger.summary = '키워드 장소 검색 (카카오)'
    #swagger.description = '사용자가 입력한 검색어(query)를 바탕으로 카카오 맵 API를 통해 장소 리스트를 반환합니다.'
    #swagger.parameters['query'] = {
        in: 'query',
        description: '검색하고자 하는 장소명 또는 키워드',
        required: true,
        type: 'string',
        example: '강남역'
    }
    */
    try {
        const query = req.query.query; // 브라우저에서 보낸 ?query=강남역 추출
        if (!query) return res.status(400).send('검색어를 입력하세요.');

        const results = await searchPlaces(query);
        res.json(results);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 외국인 관광객 맞춤형 장소 탐색 API 라우트
router.get('/search-places', async (req, res) => {
    /* #swagger.summary = '외국인 관광객 맞춤형 장소 탐색 (TripAdvisor 연동)'
    #swagger.description = '키워드로 장소를 검색하고, 상위 5개 장소에 대해 트립어드바이저 평점과 리뷰 수를 합쳐서 반환합니다.'
    #swagger.parameters['keyword'] = {
        in: 'query',
        description: '장소 검색 키워드',
        required: true,
        type: 'string',
        example: 'Gyeongbokgung'
    }
    #swagger.parameters['targetLang'] = {
        in: 'query',
        description: '응답받을 언어 코드 (ko, en, ja 등)',
        required: false,
        type: 'string',
        example: 'en'
    }
    */
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

router.get('/recommend', async (req, res) => {
    /* #swagger.summary = '좌표 기반 카테고리별 장소 추천'
    #swagger.description = '사용자의 현재 위치(위도, 경도)를 기준으로 주변의 특정 카테고리 장소들을 추천합니다.'
    #swagger.parameters['lat'] = {
        in: 'query',
        description: '현재 위도 (Latitude)',
        required: true,
        type: 'number',
        example: 37.5665
    }
    #swagger.parameters['lng'] = {
        in: 'query',
        description: '현재 경도 (Longitude)',
        required: true,
        type: 'number',
        example: 126.9780
    }
    #swagger.parameters['categories'] = {
        in: 'query',
        description: '검색할 카테고리 코드 (콤마로 구분). CE7: 카페, FD6: 음식점',
        required: false,
        type: 'string',
        example: 'CE7,FD6'
    }
    #swagger.parameters['radius'] = {
        in: 'query',
        description: '검색 반경 (단위: 미터, 기본값 1000)',
        required: false,
        type: 'number',
        example: 500
    }
    */
    try {
        const { lat, lng, categories, radius } = req.query;

        // 필수 값 검증
        if (!lat || !lng) {
            return res.status(400).json({ error: "위도(lat)와 경도(lng)가 필요합니다." });
        }

        // 1. 카테고리 파라미터 처리
        // 프론트에서 'CE7,FD6' 처럼 콤마로 구분해서 보내면 배열로 변환합니다.
        // 입력이 없으면 기본적으로 카페(CE7)와 음식점(FD6)을 검색합니다.
        const categoryList = categories ? categories.split(',') : ['CE7', 'FD6'];
        const searchRadius = radius || 1000; // 기본 반경 1km

        // 2. 각 카테고리별로 병렬 검색 실행 (속도 최적화)
        const results = await Promise.all(
            categoryList.map(async (code) => {
                const places = await getPlacesByCategory(code.trim(), lng, lat, searchRadius);
                return {
                    category_group_code: code.trim(),
                    count: places.length,
                    places: places // 상세 장소 리스트 (id, name, address, lat, lng 등 포함)
                };
            })
        );

        // 3. 순수하게 데이터만 담아서 반환
        // 프론트엔드는 이 데이터를 받아서 원하는 대로 지도에 마커를 찍거나 리스트를 보여줍니다.
        res.json({
            status: "success",
            request_info: {
                center: { lat: Number(lat), lng: Number(lng) },
                radius: searchRadius,
                categories: categoryList
            },
            results: results
        });

    } catch (error) {
        console.error('🚨 추천 라우터 에러:', error);
        res.status(500).json({ error: "주변 장소를 불러오는 중 서버 오류가 발생했습니다." });
    }
});

router.get('/directions', async (req, res) => {
    /* #swagger.tags = ['Map (지도 관련 API)']
    #swagger.summary = '경로 탐색 (카카오 Directions)'
    #swagger.description = '출발지, 도착지, 경유지를 받아서 카카오 모빌리티 API를 통해 경로를 요청하고 결과를 가공 없이 돌려줍니다.'
    #swagger.parameters['origin'] = {
        in: 'query',
        description: '출발지 "경도,위도" (예: "127.0374,37.5447")',
        required: true,
        type: 'string',
        example: '127.0374,37.5447'
    }
    #swagger.parameters['destination'] = {
        in: 'query',
        description: '도착지 "경도,위도"',
        required: true,
        type: 'string',
        example: '127.0400,37.5500'
    }
    #swagger.parameters['waypoints'] = {
        in: 'query',
        description: '경유지들 "경도,위도|경도,위도" 형식 (최대 5개)',
        required: false,
        type: 'string'
    }
    */
    try {
        const { origin, destination } = req.query;

        // 1. 필수 파라미터 검증
        if (!origin || !destination) {
            return res.status(400).json({ error: '출발지(origin)와 도착지(destination)는 필수 파라미터입니다.' });
        }

        // 2. 카카오 서비스 계층 호출 (req.query를 통째로 전달하여 가공 없이 proxy 처리)
        const results = await getDirections(req.query);
        
        // 3. 카카오 서버의 응답을 프론트엔드에 그대로 반환
        res.json(results);

    } catch (error) {
        console.error('🚨 경로 탐색 라우터 에러:', error);
        
        // 외부 API 에러 상태코드가 있으면 그대로 전달하고, 없으면 500 처리
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data || { error: "경로 데이터를 불러오는 중 오류가 발생했습니다." };
        
        res.status(statusCode).json(errorMessage);
    }
});

module.exports = router;