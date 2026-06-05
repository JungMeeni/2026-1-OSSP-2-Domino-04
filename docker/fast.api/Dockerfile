FROM anaconda/miniconda

WORKDIR /app

# 아나콘다 이용약관(ToS) 자동 수락
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main && \
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r

# 안정적인 Python 3.11 버전의 독립된 conda 환경 생성
RUN conda create -n fastapi_env python=3.11 -y

# fastapi-server requirements.txt 복사 및 설치
COPY fastapi-server/requirements.txt .
RUN conda run -n fastapi_env pip install --no-cache-dir -r requirements.txt

# torch CPU 전용 설치 (ml-server 통합으로 추가)
RUN conda run -n fastapi_env pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu

# 앱 소스 및 ML 가중치 복사
COPY fastapi-server/app ./app
COPY fastapi-server/weights ./weights

# 생성한 가상환경 내부의 uvicorn을 지정하여 서버 실행
CMD ["conda", "run", "--no-capture-output", "-n", "fastapi_env", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
