"""
services/cache.py

Redis 기반 캐싱 전략 A / B / C 구현 + 벤치마킹 메트릭.

전략:
  A — Redis 저장, TTL 없음 (만료 없이 영구 보관)
  B — Redis 저장, TTL 있음 (데이터 종류 상관없이 단일 TTL)
  C — Redis 저장, 데이터 종류별로 TTL 다르게 적용 (최종 목표)

사용 예시:
    from app.services.cache import cache
    await cache.set("traffic:홍대", data)
    value = await cache.get("traffic:홍대")

환경변수:
    REDIS_HOST (기본값: localhost)
    REDIS_PORT (기본값: 6379)
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Redis 연결
# ──────────────────────────────────────────────

def _make_redis() -> aioredis.Redis:
    """
    환경변수에서 Redis 접속 정보를 읽어 연결 객체 생성.
    docker-compose.yml의 REDIS_HOST=redis, REDIS_PORT=6379 와 대응.
    """
    host = os.getenv("REDIS_HOST", "localhost")
    port = int(os.getenv("REDIS_PORT", 6379))
    return aioredis.Redis(
        host=host,
        port=port,
        decode_responses=True,   # bytes 대신 str로 자동 디코딩
    )


# ──────────────────────────────────────────────
# 데이터 종류별 기본 TTL (전략 C에서 사용)
# ──────────────────────────────────────────────

# 키 접두어(prefix) → TTL(초) 매핑
# None 이면 만료 없음 (영구 보관)
TTL_BY_PREFIX: dict[str, int | None] = {
    "disaster:" : None,    # 재난문자 이력 — 절대 만료시키지 않음
    "accident:" : None,    # 사고통제 이력 — 절대 만료시키지 않음
    "traffic:"  : 300,     # 교통 — 5분
    "population": 300,     # 인구 혼잡도 — 5분
}

DEFAULT_TTL = 300  # 위 목록에 없는 키의 기본값


def _ttl_for(key: str) -> int | None:
    """키 접두어를 보고 적절한 TTL 반환. 매칭 없으면 DEFAULT_TTL."""
    for prefix, ttl in TTL_BY_PREFIX.items():
        if key.startswith(prefix):
            return ttl
    return DEFAULT_TTL


# ──────────────────────────────────────────────
# 메트릭
# ──────────────────────────────────────────────

@dataclass
class CacheMetrics:
    hit_count: int = 0
    miss_count: int = 0
    set_count: int = 0
    _total_latency_ms: float = field(default=0.0, repr=False)

    @property
    def avg_latency_ms(self) -> float:
        n = self.hit_count + self.miss_count
        return self._total_latency_ms / n if n else 0.0

    @property
    def hit_rate_pct(self) -> float:
        """히트율 — 0~100 퍼센트 단위로 반환."""
        n = self.hit_count + self.miss_count
        return round(self.hit_count / n * 100, 1) if n else 0.0

    def record(self, hit: bool, latency_ms: float) -> None:
        if hit:
            self.hit_count += 1
        else:
            self.miss_count += 1
        self._total_latency_ms += latency_ms

    def to_dict(self) -> dict:
        return {
            "hit_count"      : self.hit_count,
            "miss_count"     : self.miss_count,
            "set_count"      : self.set_count,
            "avg_latency_ms" : round(self.avg_latency_ms, 1),
            "hit_rate_pct"   : self.hit_rate_pct,   # 0~100 %
        }


# ──────────────────────────────────────────────
# Protocol — 세 전략이 공통으로 따르는 규약
# ──────────────────────────────────────────────

@runtime_checkable
class CacheStrategy(Protocol):
    async def get(self, key: str) -> Any | None: ...
    async def set(self, key: str, value: Any, ttl: int | None = None) -> None: ...
    async def invalidate(self, key: str) -> None: ...
    async def close(self) -> None: ...
    def metrics(self) -> dict: ...


# ──────────────────────────────────────────────
# 전략 A — Redis 저장, TTL 없음
# ──────────────────────────────────────────────

class RedisCacheA:
    """
    전략 A: Redis에 저장하되 만료 시각을 설정하지 않음.

    동작:
      - set() 호출 시 Redis에 영구 저장 (TTL 파라미터 무시)
      - 새 데이터가 오면 덮어씀
      - 명시적으로 invalidate() 하거나 서버를 내리지 않는 한 삭제 안 됨

    언제 쓰나:
      - 벤치마킹 기준점(baseline)
      - TTL 있을 때와 없을 때 성능·메모리 차이를 비교하기 위한 전략
    """

    def __init__(self) -> None:
        self._redis = _make_redis()
        self._m = CacheMetrics()

    async def get(self, key: str) -> Any | None:
        t0 = time.perf_counter()
        raw = await self._redis.get(key)
        value = json.loads(raw) if raw is not None else None
        self._m.record(hit=value is not None, latency_ms=(time.perf_counter() - t0) * 1000)
        return value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        # ttl 파라미터를 받아도 사용하지 않음 — 전략 A의 핵심
        await self._redis.set(key, json.dumps(value, ensure_ascii=False))
        self._m.set_count += 1

    async def invalidate(self, key: str) -> None:
        await self._redis.delete(key)

    async def close(self) -> None:
        await self._redis.aclose()

    def metrics(self) -> dict:
        return {"strategy": "A", **self._m.to_dict()}


# ──────────────────────────────────────────────
# 전략 B — Redis 저장, 단일 TTL
# ──────────────────────────────────────────────

class RedisCacheB:
    """
    전략 B: Redis에 저장 + TTL(만료 시각) 설정.
    모든 키에 동일한 TTL을 적용 (데이터 종류 구분 없음).

    동작:
      - set() 호출 시 Redis에 저장하면서 TTL 설정
      - TTL이 지나면 Redis가 자동으로 키 삭제
      - 다음 get() 시 None 반환 → scheduler가 API 재호출

    언제 쓰나:
      - 전략 A와 C 사이의 중간 비교 지점
      - "TTL은 있는데 종류별 구분은 없을 때" 성능 측정용

    주의:
      - 재난문자도 TTL이 걸려서 만료됨 → 이력 보관이 필요하면 전략 C 써야 함
    """

    def __init__(self, default_ttl: int = DEFAULT_TTL) -> None:
        self._redis = _make_redis()
        self._default_ttl = default_ttl
        self._m = CacheMetrics()

    async def get(self, key: str) -> Any | None:
        t0 = time.perf_counter()
        raw = await self._redis.get(key)
        value = json.loads(raw) if raw is not None else None
        self._m.record(hit=value is not None, latency_ms=(time.perf_counter() - t0) * 1000)
        return value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        # ttl 인자가 없으면 default_ttl 사용 (300초)
        effective_ttl = ttl if ttl is not None else self._default_ttl
        await self._redis.set(
            key,
            json.dumps(value, ensure_ascii=False),
            ex=effective_ttl,    # ex = 초 단위 TTL (Redis 내장 기능)
        )
        self._m.set_count += 1

    async def invalidate(self, key: str) -> None:
        await self._redis.delete(key)

    async def close(self) -> None:
        await self._redis.aclose()

    def metrics(self) -> dict:
        return {
            "strategy"    : "B",
            "default_ttl" : self._default_ttl,
            **self._m.to_dict(),
        }


# ──────────────────────────────────────────────
# 전략 C — Redis 저장, 데이터 종류별 TTL
# ──────────────────────────────────────────────

class RedisCacheC:
    """
    전략 C (최종 목표): 데이터 종류(키 접두어)에 따라 TTL을 다르게 적용.

    동작:
      "disaster:*" / "accident:*"
        → TTL 없이 Redis에 영구 저장
        → 재난·사고 이력은 절대 자동 삭제되지 않음

      "traffic:*"   → TTL 300초   (5분, 갱신주기와 일치)
      "population:*"→ TTL 300초   (5분)
      "weather:*"   → TTL 3600초  (1시간)
      "event:*"     → TTL 86400초 (24시간)

    핵심 장점:
      - 갱신주기에 딱 맞는 TTL → 오래된 데이터를 서비스하는 시간 최소화
      - 재난 데이터는 이력이 보존되므로 "최근 재난 조회" 기능 가능
      - Express, FastAPI 두 서버가 같은 Redis를 보므로 캐시 일관성 보장
    """

    def __init__(self) -> None:
        self._redis = _make_redis()
        self._m = CacheMetrics()

    async def get(self, key: str) -> Any | None:
        t0 = time.perf_counter()
        raw = await self._redis.get(key)
        value = json.loads(raw) if raw is not None else None
        self._m.record(hit=value is not None, latency_ms=(time.perf_counter() - t0) * 1000)
        return value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """
        키 접두어 정책이 항상 우선.
        TTL_BY_PREFIX에 None(영구)으로 정의된 키는 ttl 인자를 넘겨도 무시.
        그 외 키는 ttl 인자가 있으면 그 값, 없으면 접두어 기본값 사용.
        """
        policy_ttl = _ttl_for(key)

        if policy_ttl is None:
            # 재난·사고 키: 정책이 영구 보관 → 외부 ttl 인자 무시
            effective_ttl = None
        else:
            # 그 외: 명시적 ttl > 접두어 기본값
            effective_ttl = ttl if ttl is not None else policy_ttl

        if effective_ttl is None:
            # TTL 없음 → 영구 저장 (재난, 사고)
            await self._redis.set(key, json.dumps(value, ensure_ascii=False))
        else:
            # TTL 있음 → 만료 설정
            await self._redis.set(
                key,
                json.dumps(value, ensure_ascii=False),
                ex=effective_ttl,
            )
        self._m.set_count += 1

    async def invalidate(self, key: str) -> None:
        await self._redis.delete(key)

    async def get_ttl(self, key: str) -> int:
        """
        현재 키의 남은 TTL(초) 반환.
        -1 이면 TTL 없음(영구), -2 이면 키 자체가 없음.
        디버깅·모니터링용.
        """
        return await self._redis.ttl(key)

    async def close(self) -> None:
        await self._redis.aclose()

    def metrics(self) -> dict:
        return {"strategy": "C", **self._m.to_dict()}


# ──────────────────────────────────────────────
# 팩토리 + 기본 싱글턴
# ──────────────────────────────────────────────

def create_cache(strategy: str = "C", **kwargs) -> CacheStrategy:
    """
    원하는 전략 문자열을 넘기면 해당 전략 인스턴스 반환.

    strategy: "A" | "B" | "C"
    kwargs  : RedisCacheB → default_ttl=300 등

    사용 예시:
        # 벤치마킹 시 전략 교체
        cache_a = create_cache("A")
        cache_b = create_cache("B", default_ttl=600)
        cache_c = create_cache("C")

        # 기본 사용 (전략 C)
        from app.services.cache import cache
        await cache.set("traffic:홍대", data)
    """
    match strategy:
        case "A":
            return RedisCacheA()
        case "B":
            return RedisCacheB(**kwargs)
        case "C":
            return RedisCacheC()
        case _:
            raise ValueError(f"알 수 없는 캐시 전략: {strategy!r}")


# scheduler.py / router에서 import해서 사용하는 기본 인스턴스 (전략 C)
cache: CacheStrategy = create_cache("C")