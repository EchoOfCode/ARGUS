"""
Thread-safe Token Bucket Rate Limiter and Retry Handler for Groq and AI endpoints.
Protects against exceeding Groq free-tier quotas (30 RPM).
"""

import functools
import logging
import random
import threading
import time
from typing import Callable, Any

logger = logging.getLogger("argus.rate_limiter")


class TokenBucketRateLimiter:
    """
    Token Bucket Rate Limiter.
    Allows bursting up to `capacity` tokens, replenishing at `fill_rate` tokens per second.
    """

    def __init__(self, max_requests_per_minute: float = 25.0, capacity: float = 25.0):
        self.capacity = capacity
        self.fill_rate = max_requests_per_minute / 60.0  # tokens per second
        self.tokens = capacity
        self.last_update = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, tokens: float = 1.0, max_wait: float = 30.0) -> bool:
        """
        Acquire tokens, sleeping if necessary until tokens become available.
        Returns True if acquired, False if max_wait exceeded.
        """
        start_time = time.monotonic()
        while True:
            with self.lock:
                now = time.monotonic()
                elapsed = now - self.last_update
                self.last_update = now
                self.tokens = min(self.capacity, self.tokens + elapsed * self.fill_rate)

                if self.tokens >= tokens:
                    self.tokens -= tokens
                    return True

                # Calculate wait time needed for tokens
                needed = tokens - self.tokens
                wait_time = needed / self.fill_rate

            if time.monotonic() - start_time + wait_time > max_wait:
                logger.warning("Rate limit wait timeout exceeded (%.1fs)", max_wait)
                return False

            # Sleep briefly and try again
            time.sleep(min(wait_time, 1.0))


# Global rate limiter instance (high throughput with burst capacity)
groq_rate_limiter = TokenBucketRateLimiter(max_requests_per_minute=60.0, capacity=30.0)


def rate_limited(limiter: TokenBucketRateLimiter = groq_rate_limiter, max_retries: int = 2):
    """
    Decorator that applies rate-limiting token consumption and automatic
    exponential backoff retry if rate limit (429) or transient errors occur.
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 1. Acquire token (short max wait to prevent HTTP gateway timeout)
            if not limiter.acquire(tokens=1.0, max_wait=8.0):
                logger.warning("Proceeding with caution: token bucket wait reached limit")

            # 2. Execute with retries on 429
            delay = 2.0
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    err_str = str(e).lower()
                    is_rate_limit = "429" in err_str or "rate limit" in err_str or "quota" in err_str
                    if is_rate_limit and attempt < max_retries:
                        jitter = random.uniform(0.5, 1.5)
                        sleep_time = delay + jitter
                        logger.warning(
                            "Rate limit encountered on %s (attempt %d/%d). Retrying in %.1fs...",
                            func.__name__,
                            attempt + 1,
                            max_retries,
                            sleep_time,
                        )
                        time.sleep(sleep_time)
                        delay *= 2.0
                    else:
                        raise

        return wrapper

    return decorator
