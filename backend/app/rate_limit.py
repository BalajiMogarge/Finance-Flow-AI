"""Rate limiting integration using slowapi and sliding window tracking.

Protects critical endpoints (auth/login, invoice uploads) from abuse
and denial-of-service attempts.
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Global slowapi Limiter instance keyed by client IP
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return uniform JSON response when slowapi rate limit is exceeded."""
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}. Please slow down and try again later."},
        headers={"Retry-After": str(exc.retry_after or 60)},
    )


class SlidingWindowRateLimiter:
    def __init__(self, requests_per_minute: int = 30) -> None:
        self.requests_per_minute = requests_per_minute
        self.window_seconds = 60
        self.history: dict[str, list[float]] = defaultdict(list)

    def check(self, identifier: str) -> None:
        now = time.time()
        window_start = now - self.window_seconds

        # Prune older timestamps
        recent = [ts for ts in self.history[identifier] if ts > window_start]
        if len(recent) >= self.requests_per_minute:
            retry_after = int(self.window_seconds - (now - recent[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded ({self.requests_per_minute}/min). Please retry in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )

        recent.append(now)
        self.history[identifier] = recent


upload_rate_limiter = SlidingWindowRateLimiter(requests_per_minute=30)
api_rate_limiter = SlidingWindowRateLimiter(requests_per_minute=120)


def rate_limit_upload(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    upload_rate_limiter.check(client_ip)


def rate_limit_api(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    api_rate_limiter.check(client_ip)
