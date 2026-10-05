"""Lightweight in-memory rate limiter for upload and API endpoints.

Prevents denial-of-service and runaway loops by tracking client IP and token windows.
Requires zero external dependencies like Redis, keeping the app strictly within
free-tier and open-source constraints.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Dict, List
from fastapi import HTTPException, Request, status


class SlidingWindowRateLimiter:
    def __init__(self, requests_per_minute: int = 30) -> None:
        self.requests_per_minute = requests_per_minute
        self.window_seconds = 60
        self.history: Dict[str, List[float]] = defaultdict(list)

    def check(self, identifier: str) -> None:
        now = time.time()
        window_start = now - self.window_seconds

        # Prune older entries
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
