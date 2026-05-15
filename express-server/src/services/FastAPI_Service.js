const axios = require('axios');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://fastapi:8000';

// 재난문자 파싱 요청
const parseDisaster = async (message) => {
  const response = await axios.post(`${FASTAPI_URL}/disaster/analyze`, {
    message
  });
  return response.data;
};

// 경로 가중치 계산 요청
const calculateRoute = async (routeData) => {
  const response = await axios.post(`${FASTAPI_URL}/route/calculate`, {
    routeData
  });
  return response.data;
};

module.exports = { parseDisaster, calculateRoute };