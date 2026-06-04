const axios = require('axios');

class PublicDataService {
    constructor() {
        this.baseUrl = 'https://api.odcloud.kr/api';
        // Set PUBLIC_DATA_API_KEY in .env (use decoded key)
        this.serviceKey = process.env.PUBLIC_DATA_API_KEY;
    }

    async getMediaLocations(pageNo = 1, numOfRows = 10) {
        try {
            // Update endpoint path according to the API spec you were issued
            const endpoint = '/15111405/v1/uddi:d8741b9c-f484-4ea8-8f54-bd21ab62de14';

            // Param names changed: pageNo -> page, numOfRows -> perPage
            // returnType removed (ODCloud defaults to JSON)
            const url = `${this.baseUrl}${endpoint}`;

            const requestConfig = {
                params: {
                    serviceKey: this.serviceKey,
                    page: pageNo,
                    perPage: numOfRows,
                    returnType: 'JSON'
                },
                headers: {
                    // ODCloud (infuser) API requires the 'Infuser ' prefix
                    'Authorization': `Infuser ${this.serviceKey}`
                }
            };

            const response = await axios.get(url, requestConfig);
            return response.data;
        } catch (error) {
            if (error.response) {
                console.error('[ERROR] Public Data API response error:', error.response.data);
            } else {
                console.error('[ERROR] Public Data API call failed:', error.message);
            }
            throw error;
        }
    }
}

module.exports = new PublicDataService();
