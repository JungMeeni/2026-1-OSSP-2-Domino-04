const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: '공개SW 프로젝트 API',
    description: '설명 적기 귀찮아서 자동으로 만든 문서'
  },
  host: 'localhost:3000'
};

const outputFile = './swagger-output.json'; // 생성될 문서 파일 이름
const endpointsFiles = ['./app.js']; // 라우트가 시작되는 파일 (보통 app.js)

swaggerAutogen(outputFile, endpointsFiles, doc);