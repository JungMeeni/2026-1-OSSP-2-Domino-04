from fastapi import APIRouter

router = APIRouter()

@router.post("/parse")
async def parse_disaster(data: dict):
    # 재난문자 파싱 로직
    return {"message": "ok"}