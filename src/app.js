const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

// 보안 관련 패키지 로드
const helmet = require('helmet');
const cors = require('cors');

// 환경변수 로드 (실행 위치에 구애받지 않도록 절대 경로 명시)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// 1. 공통 및 보안 미들웨어 설정
app.use(helmet()); // HTTP 헤더 보안 취약점 방어
app.use(cors());   // 클라이언트 도메인 접근 허용
app.use(express.json()); // JSON Payload 파싱
app.use(express.urlencoded({ extended: true })); // URL-encoded Payload 파싱

// 2. 라우터 모듈 분리 및 로드
const authRoutes = require('./routes/auth');
const mapRoutes = require('./routes/map');
const mediaRoutes = require('./routes/media');

// 3. 엔드포인트별 라우터 매핑 (계층화)
app.use('/api/auth', authRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/media', mediaRoutes);

// 4. 전역 에러 핸들링 미들웨어 (반드시 라우터 매핑 하단에 위치)
app.use((err, req, res, next) => {
    // 서버 내부 로깅용 에러 스택 출력
    console.error(err.stack); 
    // 클라이언트에게는 보안상 추상화된 메시지만 응답
    res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

// 5. 서버 실행 제어
const PORT = process.env.PORT || 3000;
// 직접 실행(node app.js)될 때만 서버를 구동하고, 모듈로 import 될 때는 구동하지 않음
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
app.get('/', (req, res) => res.send('API Server is Running!'));
module.exports = app;