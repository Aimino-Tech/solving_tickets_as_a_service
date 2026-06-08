import pytest
from app.common.rate_limiter import TokenBucket, PlatformRateLimiter, RateLimitExceeded


def test_token_bucket_acquire():
    bucket = TokenBucket(capacity=3, refill_rate=1, refill_period=1.0)
    assert bucket.acquire() is True
    assert bucket.acquire() is True
    assert bucket.acquire() is True
    assert bucket.acquire() is False


def test_token_bucket_refill():
    bucket = TokenBucket(capacity=3, refill_rate=3, refill_period=1.0)
    assert bucket.acquire() is True
    assert bucket.acquire() is True
    assert bucket.acquire() is True


def test_rate_limiter_exceeded():
    limiter = PlatformRateLimiter(
        platform="test",
        max_requests=2,
        window_seconds=86400,
        burst_size=2,
    )
    limiter.check()
    limiter.check()
    with pytest.raises(RateLimitExceeded):
        limiter.check()


def test_handle_429():
    limiter = PlatformRateLimiter(platform="test", max_requests=100, window_seconds=86400)
    wait = limiter.handle_429(retry_after=30.0)
    assert 28 <= wait <= 32


def test_handle_429_default():
    limiter = PlatformRateLimiter(platform="test", max_requests=100, window_seconds=86400)
    wait = limiter.handle_429(None)
    assert 58 <= wait <= 62
