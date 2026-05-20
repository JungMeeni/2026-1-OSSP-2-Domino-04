// const admin = require('firebase-admin');

// // 1. Firebase Admin SDK 초기화
// // 보안: 서비스 계정 키 파일 경로는 하드코딩하지 않고 환경변수(.env)로 관리합니다.
// const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
// if (!serviceAccountPath) {
//     console.error('FIREBASE_SERVICE_ACCOUNT_PATH 환경변수가 설정되지 않았습니다.');
// } else {
//     admin.initializeApp({
//         credential: admin.credential.cert(require(serviceAccountPath))
//     });
// }

// class FirebaseService {
//     /**
//      * 회원가입: Admin SDK를 사용하여 서버 단에서 안전하게 사용자 생성
//      * @param {string} email 
//      * @param {string} password 
//      */
//     static async signUp(email, password) {
//         try {
//             const userRecord = await admin.auth().createUser({
//                 email: email,
//                 password: password,
//             });
            
//             // 클라이언트에게 반환할 최소한의 식별 정보만 추출 (보안 목적)
//             return {
//                 uid: userRecord.uid,
//                 email: userRecord.email,
//             };
//         } catch (error) {   
//             console.error('[Firebase_Service] SignUp Error:', error.message);
//             // 에러 메시지 추상화: 클라이언트에게 Firebase의 구체적인 에러(예: 데이터베이스 구조) 노출 방지
//             throw new Error(error.code === 'auth/email-already-exists' 
//                 ? '이미 사용 중인 이메일입니다.' 
//                 : '회원가입 처리 중 오류가 발생했습니다.');
//         }
//     }

//     /**
//      * 로그인: Identity Toolkit REST API를 활용하여 비밀번호 검증 및 토큰 발급
//      * @param {string} email 
//      * @param {string} password 
//      */
//     static async signIn(email, password) {
//         try {
//             const apiKey = process.env.FIREBASE_API_KEY; // Firebase 프로젝트 설정의 Web API Key
//             if (!apiKey) throw new Error('FIREBASE_API_KEY 환경변수가 설정되지 않았습니다.');

//             const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

//             // Node.js 18 이상 환경을 가정하여 내장 fetch 사용
//             const response = await fetch(url, {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({
//                     email,
//                     password,
//                     returnSecureToken: true // JWT 기반의 idToken 발급 요청
//                 })
//             });

//             const data = await response.json();

//             if (!response.ok) {
//                 // Firebase REST API의 에러 규격에 맞춘 예외 처리
//                 throw new Error(data.error.message);
//             }

//             // 인증 성공 시 세션 유지를 위한 토큰 정보 반환
//             return {
//                 uid: data.localId,
//                 idToken: data.idToken,           // 클라이언트 API 요청 시 Bearer 헤더에 사용
//                 refreshToken: data.refreshToken, // idToken 만료 시 갱신용
//                 expiresIn: data.expiresIn
//             };
//         } catch (error) {
//             console.error('[Firebase_Service] SignIn Error:', error.message);
//             throw new Error('이메일 또는 비밀번호가 올바르지 않거나 인증 서버에 연결할 수 없습니다.');
//         }
//     }
// }

// module.exports = FirebaseService;