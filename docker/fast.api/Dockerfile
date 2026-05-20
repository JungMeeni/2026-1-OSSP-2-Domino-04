FROM anaconda/miniconda

WORKDIR /app

# 1. 아나콘다 이용약관(ToS) 자동 수락 명령 추가
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main && \
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r

# 안정적인 Python 3.11 버전의 독립된 conda 환경 생성
RUN conda create -n fastapi_env python=3.11 -y

# 빌드 컨텍스트(BackEnd) 기준으로 fastapi-server 안의 requirements.txt 복사
COPY fastapi-server/requirements.txt .

# 생성한 가상환경(fastapi_env) 내부의 pip를 사용하여 패키지 설치
RUN conda run -n fastapi_env pip install --no-cache-dir -r requirements.txt

# fastapi-server 안의 app 폴더를 컨테이너의 /app/app으로 복사
COPY fastapi-server/app ./app

# 생성한 가상환경 내부의 uvicorn을 지정하여 서버 실행
CMD ["conda", "run", "--no-capture-output", "-n", "fastapi_env", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# 기존: CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]