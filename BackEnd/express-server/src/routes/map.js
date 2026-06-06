const express = require('express');
const router = express.Router();
const axios = require('axios');
const { calculateRoute } = require('../services/FastAPI_Service');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://fastapi:8000';

// =========================================================================
// 1. Tripadvisor location_id 조회
// GET /api/tripadvisor/search
// =========================================================================

router.get('/tripadvisor/search', async (req, res) => {
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
                'Referer': 'https://idfriend.kr',
                'Origin':  'https://idfriend.kr',
                'accept':  'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('🚨 Tripadvisor 장소 검색 에러:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '장소 검색에 실패했습니다.' });
    }
});

// =========================================================================
// 2. Tripadvisor 장소 상세 (평점·리뷰수)
// GET /api/tripadvisor/details/:locationId
// =========================================================================

router.get('/tripadvisor/details/:locationId', async (req, res) => {
    try {
        const { locationId } = req.params;

        if (!locationId || locationId === 'undefined' || locationId === 'null') {
            return res.status(400).json({ error: '유효하지 않은 locationId 입니다.' });
        }

        const response = await axios.get(`https://api.content.tripadvisor.com/api/v1/location/${locationId}/details`, {
            params: {
                language: 'ko',
                key: process.env.TRIPADVISOR_API_KEY
            },
            headers: {
                'Referer': 'https://idfriend.kr',
                'Origin':  'https://idfriend.kr',
                'accept':  'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error(`🚨 Tripadvisor 장소 상세 에러 (ID: ${req.params.locationId}):`, error.response?.data || error.message);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '장소 상세 정보를 불러오는데 실패했습니다.' });
    }
});

// =========================================================================
// 3. 경로 탐색 — 카카오 Directions + FastAPI 재난 분석
// GET /api/directions
// =========================================================================

router.get('/directions', async (req, res) => {
    try {
        const { origin, destination } = req.query;

        if (!origin || !destination) {
            return res.status(400).json({ error: '출발지(origin)와 도착지(destination)는 필수 파라미터입니다.' });
        }

        // 카카오 Directions API
        const kakaoResponse = await axios.get(process.env.KAKAO_DIRECTIONS_URL, {
            params: req.query,
            headers: { 'Authorization': `KakaoAK ${process.env.KAKAO_REST_API_KEY}` }
        });
        const kakaoData = kakaoResponse.data;

        // FastAPI 재난 구간 분석 (실패해도 경로 응답은 반환)
        let disasterAnalysis = null;
        try {
            disasterAnalysis = await calculateRoute(kakaoData);
        } catch (fastapiError) {
            console.error('[WARN] Disaster analysis failed:', fastapiError.message);
        }

        res.json({ route: kakaoData, disaster_analysis: disasterAnalysis });
    } catch (error) {
        console.error('🚨 카카오 경로 탐색 에러:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '경로 데이터를 불러오는 중 오류가 발생했습니다.' });
    }
});

// =========================================================================
// 4. 경로 추천 — FastAPI ML 모델 (MLP 채점 + Held-Karp+2-opt)
// POST /api/route/recommend
// =========================================================================

router.post('/route/recommend', async (req, res) => {
    try {
        const response = await axios.post(`${FASTAPI_URL}/route/recommend`, req.body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
        });
        res.json(response.data);
    } catch (error) {
        console.error('🚨 경로 추천 AI 오류:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '경로 추천에 실패했습니다.' });
    }
});

// =========================================================================
// 5. ML 피드백 — MLP 가중치 온라인 학습
// POST /api/route/recommend/feedback
// =========================================================================

router.post('/route/recommend/feedback', async (req, res) => {
    try {
        const response = await axios.post(`${FASTAPI_URL}/route/recommend/feedback`, req.body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
        });
        res.json(response.data);
    } catch (error) {
        console.error('🚨 ML 피드백 오류:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: 'ML 피드백 처리에 실패했습니다.' });
    }
});

// =========================================================================
// 6. 카테고리 가중치 피드백 — 맞춤 코스 EMA 갱신
// POST /api/route/feedback
// =========================================================================

router.post('/route/feedback', async (req, res) => {
    try {
        const response = await axios.post(`${FASTAPI_URL}/route/feedback`, req.body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });
        res.json(response.data);
    } catch (error) {
        console.error('🚨 카테고리 가중치 피드백 오류:', error);
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(error.response?.data || { error: '가중치 피드백 처리에 실패했습니다.' });
    }
});

module.exports = router;
