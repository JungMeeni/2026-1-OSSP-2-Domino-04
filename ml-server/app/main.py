from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import routemodel

app = FastAPI(
    title="DOMINO ML Server",
    description="경로 추천 ML 모델 서버 (MLP 채점 + Held-Karp+2-opt)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routemodel.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
