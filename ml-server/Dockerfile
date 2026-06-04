FROM anaconda/miniconda

WORKDIR /app

RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main && \
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r

RUN conda create -n ml_env python=3.11 -y

RUN mkdir -p /app/weights

COPY ml-server/requirements.txt .

RUN conda run -n ml_env pip install --no-cache-dir -r requirements.txt && \
    conda run -n ml_env pip install --no-cache-dir \
      torch --index-url https://download.pytorch.org/whl/cpu

COPY ml-server/app ./app
COPY ml-server/weights ./weights

CMD ["conda", "run", "--no-capture-output", "-n", "ml_env", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
