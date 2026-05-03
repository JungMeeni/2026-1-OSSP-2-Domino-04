const axios = require('axios');

class PublicDataService {
    constructor() {
        this.baseUrl = 'https://api.odcloud.kr/api';
        // .env 파일에 PUBLIC_DATA_API_KEY를 설정해야 합니다. (디코딩된 키 사용 권장)
        this.serviceKey = process.env.PUBLIC_DATA_API_KEY; 
    }

    async getMediaLocations(pageNo = 1, numOfRows = 10) {
        try {
            // 상세 엔드포인트 경로는 실제 발급받은 API 명세에 따라 수정 필요
            const endpoint = '/15111389/v1/uddi:41944402-8249-4e45-9e9d-a52d0a7db1cc';
            const url = `${this.baseUrl}${endpoint}`;

            const response = await axios.get(url, {
                params: {
                    serviceKey: this.serviceKey,
                    pageNo: pageNo,
                    numOfRows: numOfRows,
                    returnType: 'JSON'
                }
            });

            return response.data;
        } catch (error) {
            console.error('공공데이터 API 호출 오류:', error.message);
            throw error;
        }
    }
}

module.exports = new PublicDataService();