from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session      # 추가됨!
from sqlalchemy import text             # 추가됨!
from dotenv import load_dotenv

from app.routers import disaster, route
from app.database import get_db         # 추가됨!

load_dotenv()

app = FastAPI()

app.include_router(disaster.router, prefix="/disaster")
app.include_router(route.router, prefix="/route")

@app.get("/")
def health_check():
    return {"status": "ok"} 

@app.get("/db-test")
def test_db_connection(db: Session = Depends(get_db)):
    try:
        # DB에 간단한 숫자 1을 반환하라는 쿼리를 날려봅니다.
        result = db.execute(text("SELECT 1")).scalar()
        return {"status": "success", "message": f"DB 연결 완벽합니다! 반환값: {result} 🎉"}
    except Exception as e:
        return {"status": "error", "message": f"DB 연결 실패 ㅠㅠ: {str(e)}"}