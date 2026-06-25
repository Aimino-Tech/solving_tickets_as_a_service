from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from workers.budget.models import Budget, BudgetStatus, ModelPricing

logger = logging.getLogger(__name__)

DB_PATH_ENV = "STAS_BUDGET_DB_PATH"
DEFAULT_DB_PATH = "/tmp/stas_budget.db"


class BudgetTracker:
    def __init__(self, db_path: str = "") -> None:
        self._db_path = db_path or os.getenv(DB_PATH_ENV, DEFAULT_DB_PATH)
        self._pricing = ModelPricing()
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS budgets (
                        tenant_id TEXT PRIMARY KEY,
                        monthly_token_cap INTEGER DEFAULT 0,
                        monthly_cost_cap REAL DEFAULT 0.0,
                        tokens_used INTEGER DEFAULT 0,
                        cost_incurred REAL DEFAULT 0.0,
                        status TEXT DEFAULT 'active',
                        billing_cycle_start TEXT,
                        billing_cycle_end TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    );
                    CREATE TABLE IF NOT EXISTS usage_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id TEXT NOT NULL,
                        task_id TEXT,
                        model TEXT,
                        input_tokens INTEGER DEFAULT 0,
                        output_tokens INTEGER DEFAULT 0,
                        total_tokens INTEGER DEFAULT 0,
                        cost REAL DEFAULT 0.0,
                        timestamp TEXT,
                        FOREIGN KEY (tenant_id) REFERENCES budgets(tenant_id)
                    );
                """)
                conn.commit()
            finally:
                conn.close()

    def get_or_create_budget(self, tenant_id: str) -> Budget:
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                row = conn.execute(
                    "SELECT * FROM budgets WHERE tenant_id = ?", (tenant_id,)
                ).fetchone()
                if row:
                    return Budget(
                        tenant_id=row[0],
                        monthly_token_cap=row[1],
                        monthly_cost_cap=row[2],
                        tokens_used=row[3],
                        cost_incurred=row[4],
                        status=BudgetStatus(row[5]),
                        billing_cycle_start=row[6] or "",
                        billing_cycle_end=row[7] or "",
                    )
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """INSERT INTO budgets (tenant_id, status, created_at, updated_at)
                       VALUES (?, 'active', ?, ?)""",
                    (tenant_id, now, now),
                )
                conn.commit()
                return Budget(tenant_id=tenant_id)
            finally:
                conn.close()

    def track_usage(
        self,
        tenant_id: str,
        task_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, Any]:
        total_tokens = input_tokens + output_tokens
        cost = self._pricing.get_cost(model, input_tokens, output_tokens)
        now = datetime.now(timezone.utc).isoformat()

        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.execute(
                    """INSERT INTO usage_log (tenant_id, task_id, model, input_tokens,
                       output_tokens, total_tokens, cost, timestamp)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (tenant_id, task_id, model, input_tokens, output_tokens, total_tokens, cost, now),
                )
                conn.execute(
                    """UPDATE budgets SET tokens_used = tokens_used + ?,
                       cost_incurred = cost_incurred + ?, updated_at = ?
                       WHERE tenant_id = ?""",
                    (total_tokens, cost, now, tenant_id),
                )
                conn.commit()
            finally:
                conn.close()

        budget = self.get_or_create_budget(tenant_id)
        return {
            "tenant_id": tenant_id,
            "total_tokens": total_tokens,
            "cost": cost,
            "tokens_used": budget.tokens_used,
            "cost_incurred": budget.cost_incurred,
            "usage_ratio": budget.usage_ratio(),
            "status": budget.status.value,
        }

    def get_usage(self, tenant_id: str) -> dict[str, Any]:
        budget = self.get_or_create_budget(tenant_id)
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                rows = conn.execute(
                    "SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost) FROM usage_log WHERE tenant_id = ?",
                    (tenant_id,),
                ).fetchone()
                return {
                    "tenant_id": tenant_id,
                    "tokens_used": budget.tokens_used,
                    "cost_incurred": budget.cost_incurred,
                    "monthly_token_cap": budget.monthly_token_cap,
                    "monthly_cost_cap": budget.monthly_cost_cap,
                    "usage_ratio": budget.usage_ratio(),
                    "status": budget.status.value,
                    "total_runs": rows[0] or 0,
                    "total_input_tokens": rows[1] or 0,
                    "total_output_tokens": rows[2] or 0,
                    "total_cost": rows[3] or 0.0,
                }
            finally:
                conn.close()

    def reset_billing_cycle(self, tenant_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.execute(
                    """UPDATE budgets SET tokens_used = 0, cost_incurred = 0,
                       status = 'active', updated_at = ?, billing_cycle_start = ?
                       WHERE tenant_id = ?""",
                    (now, now, tenant_id),
                )
                conn.execute("DELETE FROM usage_log WHERE tenant_id = ?", (tenant_id,))
                conn.commit()
            finally:
                conn.close()
        logger.info("Budget billing cycle reset for tenant %s", tenant_id)

    def set_budget_limits(
        self,
        tenant_id: str,
        monthly_token_cap: int = 0,
        monthly_cost_cap: float = 0.0,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.execute(
                    """UPDATE budgets SET monthly_token_cap = ?, monthly_cost_cap = ?,
                       updated_at = ? WHERE tenant_id = ?""",
                    (monthly_token_cap, monthly_cost_cap, now, tenant_id),
                )
                conn.commit()
            finally:
                conn.close()
        logger.info(
            "Budget limits set for %s: token_cap=%d cost_cap=%.2f",
            tenant_id,
            monthly_token_cap,
            monthly_cost_cap,
        )
