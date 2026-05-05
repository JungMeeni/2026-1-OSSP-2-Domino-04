const mysql = require('mysql2');

// MySQL 연결 풀 생성 (연결 재사용으로 성능 향상)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Promise 기반 연결 객체 내보내기
const promisePool = pool.promise();

module.exports = promisePool;