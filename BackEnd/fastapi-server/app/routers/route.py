from fastapi import APIRouter

router = APIRouter()

@router.post("/calculate")
async def calculate_route(data: dict):
    # 가중치 계산 로직
    return {"message": "ok"}