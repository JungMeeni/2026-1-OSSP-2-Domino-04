const mysql = require('mysql2/promise');

// 1. MySQL 연결 풀 생성
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 2. DB 초기 연결 상태 검증 및 재시도 로직
async function ensureDbConnection(retries = 5, delay = 5000) {
    while (retries > 0) {
        try {
            // 풀에서 임시로 연결을 하나 가져와서 DB 응답 확인
            const connection = await pool.getConnection();
            console.log("DB 연결 풀 초기화 및 연결 성공");
            connection.release(); // 확인 완료 후 풀에 반환
            return;
        } catch (error) {
            retries -= 1;
            console.log(`DB 연결 준비 대기 중... 남은 재시도 횟수: ${retries}`);
            if (retries === 0) {
                console.error("DB 연결 최종 실패");
                process.exit(1); // DB 필수 서비스인 경우 서버 강제 종료
            }
            // 지정된 시간(delay)만큼 대기 후 다음 루프 실행
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

// 모듈 로드 시 연결 확인 즉시 실행
ensureDbConnection();

// 3. 기존과 동일하게 Pool 객체 내보내기
module.exports = pool;
