from fastapi import FastAPI
from app.routers import disaster, route
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.include_router(disaster.router, prefix="/disaster")
app.include_router(route.router, prefix="/route")

@app.get("/")
def health_check():
    return {"status": "ok"}