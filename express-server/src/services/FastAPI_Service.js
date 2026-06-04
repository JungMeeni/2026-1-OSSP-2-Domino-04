const axios = require('axios');

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://fastapi:8000';

const parseDisaster = async (message) => {
  try {
    const response = await axios.post(`${FASTAPI_URL}/disaster/analyze`, {
      message
    }, { timeout: 10000 });
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error('AI 분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`재난 문자 분석 실패: ${msg}`);
  }
};

const calculateRoute = async (routeData) => {
  try {
    const response = await axios.post(`${FASTAPI_URL}/route/calculate`, {
      routeData
    }, { timeout: 10000 });
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error('AI 분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`경로 계산 실패: ${msg}`);
  }
};

const recommendRoutes = async (user_lat, user_lng, places) => {
  try {
    const response = await axios.post(`${FASTAPI_URL}/route/recommend`, {
      user_lat, user_lng, places
    }, { timeout: 30000 });
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error('AI 분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`경로 추천 실패: ${msg}`);
  }
};

module.exports = { parseDisaster, calculateRoute, recommendRoutes };
