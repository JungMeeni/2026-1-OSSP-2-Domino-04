require('dotenv').config();//kakao rest api key를 .env 파일에서 불러오기 위해 dotenv 패키지 사용
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors'); // 추가됨
const axios = require('axios'); // 추가됨
const serviceAccount = require('./firebase-adminsdk.json');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Firebase Admin SDK 초기화
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

//1. 로깅 미들웨어 (모든 요청 로그 기록)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Request Received`);
  next();
});

// 2. 통합된 루트 경로 (JSON 응답)
app.get('/', (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Firebase 및 Firestore가 연결된 API 서버가 Docker에서 작동 중입니다.",
    timestamp: new Date().toISOString()
  });
});

// 3. Firestore 데이터 저장 테스트 경로
app.get('/test-db', async (req, res) => {
  try {
    const testDoc = db.collection('test_collection').doc('test_doc');
    await testDoc.set({
      message: "Firestore 데이터 저장 성공!",
      timestamp: new Date(),
      status: "Active"
    });
    res.send('✅ 성공적으로 Firestore에 데이터를 기록했습니다! Firebase 콘솔을 확인하세요.');
  } catch (error) {
    console.error("❌ DB 에러:", error);
    res.status(500).send('❌ DB 기록 실패: ' + error.message);
  }
});
// 4. 카카오맵 장소 검색 엔드포인트
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;

  if (!query) {
    return res.status(400).json({ status: "error", message: "검색어를 입력하세요(?query=검색어)" });
  }

  try {
    const response = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      params: { query: query },
      headers: { 'Authorization': `KakaoAK ${KAKAO_KEY}` }
    });

    const places = response.data.documents.map(place => ({
      name: place.place_name,
      address: place.address_name,
      x: place.x,
      y: place.y
    }));

    res.json({ status: "success", count: places.length, data: places });
  } catch (error) {
    console.error("❌ 카카오 API 에러:", error.message);
    res.status(500).json({ status: "error", message: "카카오 API 호출에 실패했습니다." });
  }
});


app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 서버가 실행 중입니다: http://localhost:${port}`);
  console.log("🔥 Firebase 및 Kakao API 환경 준비 완료");
});