const express = require('express');
const router = express.Router();
const FirebaseService = require('../services/Firebase_Service');

// 회원가입 라우트
router.post('/signup', async (req, res, next) => {
    try {
        // [테스트 코드] 강제 에러 발생 (http://.../api/auth/signup?forceError=true)
        if (req.query.forceError === 'true') {
            throw new Error('[Test] 회원가입 라우터 강제 에러 발생');
        }

        const { email, password } = req.body;

        // 필수 파라미터 누락 검증 (기본적인 방어 로직)
        if (!email || !password) {
            return res.status(400).json({ success: false, message: '이메일과 비밀번호가 필요합니다.' });
        }

        // 서비스 계층으로 데이터 전달
        const userRecord = await FirebaseService.signUp(email, password);
        
        res.status(201).json({ success: true, data: userRecord });
    } catch (error) {
        // 발생한 에러를 app.js의 글로벌 에러 핸들러로 위임
        next(error); 
    }
});

// 로그인 라우트
router.post('/login', async (req, res, next) => {
    try {
        // [테스트 코드] 강제 에러 발생 (http://.../api/auth/login?forceError=true)
        if (req.query.forceError === 'true') {
            throw new Error('[Test] 로그인 라우터 강제 에러 발생');
        }

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: '이메일과 비밀번호가 필요합니다.' });
        }

        // 서비스 계층으로 데이터 전달
        const loginData = await FirebaseService.signIn(email, password);
        
        res.status(200).json({ success: true, data: loginData });
    } catch (error) {
        next(error);
    }
});

module.exports = router;