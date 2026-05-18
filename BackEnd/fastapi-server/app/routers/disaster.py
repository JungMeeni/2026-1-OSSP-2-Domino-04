import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv()

router = APIRouter(
    tags=["Disaster"]
)

# API 키 로드 및 클라이언트 초기화
SEOUL_API_KEY = os.getenv("SEOUL_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# API 키가 제대로 로드되었는지 확인하는 디버깅 코드
if not GEMINI_API_KEY:
    print("❌ 에러: .env 파일에 GEMINI_API_KEY가 설정되지 않았습니다.")

client = genai.Client(api_key=GEMINI_API_KEY)

class AlertRequest(BaseModel):
    alert_text: str

# --- 기능 1: 서울시 재난문자 가져오기 (전역) ---
@router.get("/seoul/latest")
async def get_latest_seoul_disasters():
    url = f"http://openapi.seoul.go.kr:8088/{SEOUL_API_KEY}/json/ListEmergencyDisasterMsg/1/5/"
    async with httpx.AsyncClient(timeout=10.0) as client_httpx:
        response = await client_httpx.get(url)
        if response.status_code != 200:
            return {"status": "error", "message": "서울시 API 호출 실패"}
        data = response.json()
        if "ListEmergencyDisasterMsg" not in data:
            return {"status": "success", "data": [], "note": "최근 재난문자 없음"}
        
        result = []
        for row in data["ListEmergencyDisasterMsg"]["row"]:
            result.append({"date": row.get("STR_DATE"), "msg": row.get("MSG")})
        return {"status": "success", "data": result}

# --- 기능 2: Gemini 분석 (400 에러 및 오타 수정 버전) ---
@router.post("/analyze")
async def analyze_disaster(request: AlertRequest):
    # 모델 이름을 'models/gemini-2.5-flash' 형식으로 명시하여 400 에러 방지
    model_name = 'models/gemini-2.5-flash'
    
    prompt = f"""
    다음은 서울시 재난 문자입니다: "{request.alert_text}"
    이 문자를 분석하여 재난이 발생한 중심 위치의 위도(lat), 경도(lng)를 추출하고, 
    사용자가 우회해야 할 위험 반경(radius, 미터 단위)을 분석해 주세요.
    반드시 마크다운 형식 없이 순수한 JSON 포맷으로만 응답하세요.
    예시: {{"lat": 37.5665, "lng": 126.9780, "radius": 500}}
    """
    
    try:
        response = client.models.generate_content(
            model=model_name, 
            contents=prompt,
        )
        
        # 1. 마크다운 기호 제거 (안전장치)
        clean_json = response.text.strip().replace("```json", "").replace("```", "")
        
        # 2. 결과 반환 (오타 수정: response.text 대신 clean_json 반환)
        return {"status": "success", "analysis": clean_json}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}