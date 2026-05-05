const admin = require('firebase-admin');
const serviceAccount = require('../../firebase-adminsdk.json'); // 상위 폴더 참조

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = db;