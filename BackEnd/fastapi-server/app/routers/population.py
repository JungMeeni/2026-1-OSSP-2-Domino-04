import os
import httpx
from fastapi import APIRouter, HTTPException
from dotenv import load_dotenv

load_dotenv()
router = APIRouter(tags=["Population"])

SEOUL_API_KEY = os.getenv("SEOUL_API_KEY")

@router.get("/{area_name}/congestion")
async def get_area_congestion(area_name: str):
    """
    특정 지역의 실시간 혼잡도 수준과 메시지를 가져옵니다.
    예: GET /population/강남역/congestion
    """
    if not SEOUL_API_KEY:
        raise HTTPException(status_code=500, detail="API 키 설정을 확인해주세요.")

    # 서비스명: citydata
    url = f"http://openapi.seoul.go.kr:8088/{SEOUL_API_KEY}/json/citydata/1/1/{area_name}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url)
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="서울시 API 호출 실패")
            
        data = response.json()
        
        if "CITYDATA" not in data:
            return {"status": "error", "message": "장소명을 정확히 입력해주세요.", "input": area_name}

        # 인구 현황(LIVE_PPLTN_STTS) 데이터 추출
        # 매뉴얼상 LIVE_PPLTN_STTS는 리스트 형태이므로 첫 번째 요소를 가져옵니다.
        pop_data = data["CITYDATA"].get("LIVE_PPLTN_STTS", [{}])[0]
        
        congestion_level = pop_data.get("AREA_CONGEST_LVL") # 예: 여유, 보통, 약간 혼잡, 매우 혼잡
        congestion_msg = pop_data.get("AREA_CONGEST_MSG")     # 상세 설명 메시지
        
        return {
            "status": "success",
            "area": area_name,
            "congestion": {
                "level": congestion_level,
                "message": congestion_msg
            }
        }