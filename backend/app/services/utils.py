from typing import Optional
import math
from app.config import get_settings

settings = get_settings()


def per90(value: float, minutes: Optional[float]) -> float:
    if not minutes or minutes <= 0:
        return 0.0
    return float(value) * 90.0 / float(minutes)


def safe_div(a: float, b: float, default: float = 0.0) -> float:
    if not b or b == 0:
        return default
    return a / b


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def has_sufficient_sample(n: int, threshold: Optional[int] = None) -> bool:
    return n >= (threshold or settings.MIN_SAMPLE_THRESHOLD)


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    z = math.exp(x)
    return z / (1.0 + z)


def weighted_mean(values, weights) -> float:
    s = sum(weights)
    if s <= 0:
        return 0.0
    return float(sum(v * w for v, w in zip(values, weights))) / s
