const express = require('express');
const router = express.Router();
const publicDataService = require('../services/Public_Data_Service');

/**
 * 버전 1: 모든 필드 반환 API
 * GET /api/media/locations/all
 */
router.get('/locations/all', async (req, res, next) => {
    try {
        const pageNo = req.query.pageNo || 1;
        const numOfRows = req.query.numOfRows || 10;
        
        const rawData = await publicDataService.getMediaLocations(pageNo, numOfRows);

        res.status(200).json({
            success: true,
            data: rawData.data || rawData
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 버전 2: 특정 필드만 가공하여 반환 API
 * GET /api/media/locations/summary
 */
router.get('/locations/summary', async (req, res, next) => {
    try {
        const pageNo = req.query.pageNo || 1;
        const numOfRows = req.query.numOfRows || 10;
        
        const rawData = await publicDataService.getMediaLocations(pageNo, numOfRows);
        const items = rawData.data || [];

        // 필요한 필드만 추출 (필드명은 실제 공공데이터 응답 JSON의 키값에 맞춰 수정 필요)
        const filteredData = items.map(item => ({
            mediaName: item['미디어 콘텐츠명'] || item.mediaName,
            locationName: item['촬영지명'] || item.locationName,
            address: item['주소'] || item.address,
            latitude: item['위도'] || item.lat,
            longitude: item['경도'] || item.lng
        }));

        res.status(200).json({
            success: true,
            data: filteredData
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;