import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from dotenv import load_dotenv

# 환경 변수 불러오기
load_dotenv()

# .env 파일과 docker-compose의 environment에 맞게 변수 설정
DB_USER = "root"
DB_PASSWORD = os.getenv("DB_PASSWORD", "1234")  # .env에 적힌 비밀번호 키
DB_HOST = os.getenv("MYSQL_HOST", "db")         # 도커 내부 통신용 호스트명
DB_PORT = "3306"                                # 도커 내부 포트
DB_NAME = os.getenv("DB_NAME", "domino_db")     # .env에 적힌 DB 이름

# MySQL 연결 URL 생성 (mysql+pymysql 형식을 사용합니다)
SQLALCHEMY_DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# 엔진 및 세션 생성
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# DB 세션을 가져오는 의존성 함수 (API에서 사용)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()