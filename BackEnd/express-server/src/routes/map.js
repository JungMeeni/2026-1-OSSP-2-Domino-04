const express = require('express');
const router = express.Router();
const axios = require('axios');
const { searchPlaces, getPlacesByCategory } = require('../services/Kakao_Service');
const TripAdvisorService = require('../services/TripAdvisor_Service');

// =========================================================================
// 1. 프론트엔드 명세서에 맞춘 Proxy API 3종 
// =========================================================================

/**
 * 1) 장소 검색 — Tripadvisor location_id 조회
 * GET /api/tripadvisor/search
 */
router.get('/tripadvisor/search', async (req, res) => {
    /* #swagger.tags = ['Proxy API (외부 API 대리 호출)']
    #swagger.summary = 'Tripadvisor 장소 검색 (location_id 조회)'
    #swagger.description = '장소 이름과 좌표를 바탕으로 Tripadvisor API를 호출하여 장소의 고유 ID(location_id)를 반환합니다. (CORS 에러 및 API 키 노출 방지용)'
    #swagger.parameters['searchQuery'] = {
        in: 'query',
        description: '검색하고자 하는 장소명 (예: Gyeongbokgung)',
        required: true,
        type: 'string',
        example: 'Gyeongbokgung'
    }
    #swagger.parameters['latLong'] = {
        in: 'query',
        description: '위도,경도 (Latitude,Longitude) 형식의 좌표',
        required: true,
        type: 'string',
        example: '37.579617,126.977041'
    }
    */
    try {
        const { searchQuery, latLong } = req.query;
        
        if (!searchQuery || !latLong) {
            return res.status(400).json({ error: 'searchQuery와 latLong 파라미터는 필수입니다.' });
        }

        const response = await axios.get('https://api.content.tripadvisor.com/api/v1/location/search', {
            params: {
                searchQuery,
                latLong,
                language: 'ko',
                key: process.env.TRIPADVISOR_API_KEY
            },
            headers: {
                'Referer': ''
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('🚨 Tripadvisor 장소 검색 에러:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '장소 검색에 실패했습니다.' });
    }
});

/**
 * 2) 장소 상세 — 평점·리뷰수 조회
 * GET /api/tripadvisor/details/:locationId
 */
router.get('/tripadvisor/details/:locationId', async (req, res) => {
    /* #swagger.tags = ['Proxy API (외부 API 대리 호출)']
    #swagger.summary = 'Tripadvisor 장소 상세 정보 조회 (평점/리뷰수)'
    #swagger.description = 'Tripadvisor의 location_id를 기반으로 해당 장소의 평점, 리뷰 수, 웹 URL 등의 상세 정보를 반환합니다.'
    #swagger.parameters['locationId'] = {
        in: 'path',
        description: 'Tripadvisor 장소 고유 ID',
        required: true,
        type: 'string',
        example: '3248881'
    }
    */
    try {
        const { locationId } = req.params;

        const response = await axios.get(`https://api.content.tripadvisor.com/api/v1/location/${locationId}/details`, {
            params: {
                language: 'ko',
                key: process.env.TRIPADVISOR_API_KEY
            },
            headers: {
                'Referer': ''
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('🚨 Tripadvisor 장소 상세 에러:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '장소 상세 정보를 불러오는데 실패했습니다.' });
    }
});

/**
 * 3) 경로 탐색 — 카카오 Directions
 * GET /api/directions
 */
router.get('/directions', async (req, res) => {
    /* #swagger.tags = ['Proxy API (외부 API 대리 호출)']
    #swagger.summary = '경로 탐색 (카카오 Directions Proxy)'
    #swagger.description = '출발지, 도착지, 경유지를 받아 카카오 모빌리티 API를 통해 최적의 경로(거리, 시간, 요금, 폴리라인 등)를 반환합니다.'
    #swagger.parameters['origin'] = {
        in: 'query',
        description: '출발지 "경도,위도" (예: "127.0374,37.5447")',
        required: true,
        type: 'string',
        example: '127.0374,37.5447'
    }
    #swagger.parameters['destination'] = {
        in: 'query',
        description: '도착지 "경도,위도" (예: "127.0400,37.5500")',
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

        if (!origin || !destination) {
            return res.status(400).json({ error: '출발지(origin)와 도착지(destination)는 필수 파라미터입니다.' });
        }

        const response = await axios.get(process.env.KAKAO_DIRECTIONS_URL, {
            params: req.query,
            headers: {
                'Authorization': `KakaoAK ${process.env.KAKAO_REST_API_KEY}`
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('🚨 카카오 경로 탐색 에러:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '경로 데이터를 불러오는 중 오류가 발생했습니다.' });
    }   
});

module.exports = router;