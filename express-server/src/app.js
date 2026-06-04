const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

// 보안 관련 패키지 로드
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// API 문서화 패키지 로드
const swaggerUi = require('swagger-ui-express');
const swaggerFile = require('./swagger-output.json'); // 자동 생성된 파일

// 환경변수 로드 (실행 위치에 구애받지 않도록 절대 경로 명시)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 필수 환경변수 체크 — 누락 시 서버 시작 중단
const REQUIRED_ENV_VARS = [
  'KAKAO_REST_API_KEY',
  'KAKAO_DIRECTIONS_URL',
  'TRIPADVISOR_API_KEY',
  'FASTAPI_URL',
  'SEOUL_API_KEY',
];

const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingVars.length > 0) {
  console.error('[ERROR] 필수 환경변수가 누락되었습니다:', missingVars.join(', '));
  console.error('[ERROR] .env 파일을 확인하고 서버를 재시작하세요.');
  process.exit(1);
}

const app = express();

// 1. 공통 및 보안 미들웨어 설정
app.use(helmet()); // HTTP 헤더 보안 취약점 방어

// 1-1. CORS 설정 (도메인 허용 목록)
const allowedOrigins = [
  'http://localhost:5173', // 프론트엔드 개발 환경 (Vite)
  'http://localhost:3000', // 로컬 테스트용
  process.env.BACKEND_URL, // API 서버 자체에서의 테스트용
  process.env.FRONTEND_URL, // 프로덕션 프론트엔드 주소 (.env에서 로드)
  'https://idfriend.kr',
  'http://idfriend.kr'
];

app.use(cors({
  origin: function (origin, callback) {
    // origin이 없거나(Postman 테스트 등), 허용된 목록에 포함된 경우만 통과
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));

// 1-2. Rate Limit 설정 (악의적인 매크로/봇 방어)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분 동안
  max: 60,                  // 동일 IP에서 최대 60번 요청 허용
  message: {
    success: false,
    message: '요청이 너무 많습니다. 1분 후에 다시 시도해 주세요.'
  }
});

// 모든 /api 경로에 방어막(Rate Limit) 우선 적용
app.use('/api', apiLimiter);
app.use(express.json()); // JSON Payload 파싱
app.use(express.urlencoded({ extended: true })); // URL-encoded Payload 파싱

// 2. 라우터 모듈 분리 및 로드
const mapRoutes = require('./routes/map');

// 3. 엔드포인트별 라우터 매핑 (계층화)
app.use('/api', mapRoutes);

// 4. API 문서 경로 설정
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerFile));

// 서버 상태 확인용
app.get('/', (req, res) => res.send('API Server is Running!'));

// 5. 전역 에러 핸들링 미들웨어 (반드시 라우터 매핑 하단에 위치)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
      success: false,
      message: '서버 내부 오류가 발생했습니다.'
    });
});

// 6. 서버 실행 제어 (직접 실행 시에만 구동, 모듈 import 시에는 구동하지 않음)
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`API Docs available at http://localhost:${PORT}/api-docs`);
    });
}

module.exports = app;
