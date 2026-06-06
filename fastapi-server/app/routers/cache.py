"""
routers/cache.py
-----------------
Redis 캐시 성능 지표를 노출하는 관리용 엔드포인트.

GET /cache/metrics
  - Redis hit_rate, hit/miss/set 횟수, 평균 응답 시간

인증 없이 누구나 접근 가능하므로 프로덕션에서는 IP 제한 권장.
"""

from fastapi import APIRouter

from app.services.cache import cache as redis_cache
from app.services.scheduler import scheduler

router = APIRouter(tags=["Cache"])


@router.get("/metrics")
def get_cache_metrics():
    """Redis 캐시 성능 지표 반환."""
    return {
        "status": "ok",
        "cache": redis_cache.metrics(),
        "scheduler": {
            "total_api_calls": scheduler.api_call_count,
            "seen_event_ids": scheduler.detector.seen_count,
        },
    }
