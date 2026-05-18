# 1. 파이썬 베이스 이미지 지정 (가볍고 많이 쓰이는 slim 버전 사용)
FROM python:3.11-slim

# 2. 컨테이너 내부의 작업 폴더 지정
WORKDIR /app

# 3. 파이썬 로그가 버퍼링 없이 도커 로그에 바로 찍히도록 설정 (필수 권장)
ENV PYTHONUNBUFFERED=1

# 4. 패키지 목록 파일 복사 및 설치
# (코드보다 먼저 복사해야 도커 캐시를 활용해 빌드 속도가 빨라집니다)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. 나머지 소스 코드 전체 복사
COPY . .

# 6. FastAPI 서버 실행
# 개발 환경이므로 코드 수정 시 자동 재시작되도록 --reload 옵션을 넣었습니다.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]