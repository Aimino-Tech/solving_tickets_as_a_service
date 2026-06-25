from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class BudgetStatus(str, Enum):
    ACTIVE = "active"
    WARNING = "warning"
    EXCEEDED = "exceeded"
    DISABLED = "disabled"


DEFAULT_MODEL_PRICING: dict[str, dict[str, float]] = {
    "gpt-4": {"input_per_1k": 0.03, "output_per_1k": 0.06},
    "gpt-4-turbo": {"input_per_1k": 0.01, "output_per_1k": 0.03},
    "gpt-3.5-turbo": {"input_per_1k": 0.001, "output_per_1k": 0.002},
    "claude-3-opus": {"input_per_1k": 0.015, "output_per_1k": 0.075},
    "claude-3-sonnet": {"input_per_1k": 0.003, "output_per_1k": 0.015},
    "claude-sonnet-4": {"input_per_1k": 0.003, "output_per_1k": 0.015},
}


@dataclass
class ModelPricing:
    pricing: dict[str, dict[str, float]] = field(default_factory=lambda: dict(DEFAULT_MODEL_PRICING))

    def get_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        model_key = model.lower().strip()
        rates = self.pricing.get(model_key)
        if not rates:
            for key, val in self.pricing.items():
                if key in model_key or model_key in key:
                    rates = val
                    break
        if not rates:
            rates = {"input_per_1k": 0.01, "output_per_1k": 0.03}
        input_cost = (input_tokens / 1000) * rates["input_per_1k"]
        output_cost = (output_tokens / 1000) * rates["output_per_1k"]
        return round(input_cost + output_cost, 6)


@dataclass
class Budget:
    tenant_id: str
    monthly_token_cap: int = 0
    monthly_cost_cap: float = 0.0
    tokens_used: int = 0
    cost_incurred: float = 0.0
    status: BudgetStatus = BudgetStatus.ACTIVE
    billing_cycle_start: str = ""
    billing_cycle_end: str = ""

    def is_unlimited(self) -> bool:
        return self.monthly_token_cap <= 0 and self.monthly_cost_cap <= 0.0

    def usage_ratio(self) -> float:
        ratios: list[float] = []
        if self.monthly_token_cap > 0:
            ratios.append(self.tokens_used / self.monthly_token_cap)
        if self.monthly_cost_cap > 0.0:
            ratios.append(self.cost_incurred / self.monthly_cost_cap)
        return max(ratios) if ratios else 0.0

    def should_warn(self) -> bool:
        return 0.8 <= self.usage_ratio() < 1.0 and not self.is_unlimited()

    def is_exceeded(self) -> bool:
        return self.usage_ratio() >= 1.0 and not self.is_unlimited()
