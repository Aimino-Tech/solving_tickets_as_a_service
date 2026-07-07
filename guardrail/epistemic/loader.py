"""
Configuration loader for epistemic guardrail.
Loads constraint definitions from YAML.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from guardrail.epistemic.types import Constraint, Severity

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG_PATH = Path(__file__).parent / "constraints.yaml"
_ENV_VAR = "EPISTEMIC_CONFIG_PATH"


def _parse_severity(value: str) -> Severity:
    lower = value.strip().lower()
    for s in Severity:
        if s.value == lower:
            return s
    logger.warning("Unknown severity '%s', defaulting to WARN", value)
    return Severity.WARN


def load_constraints(config_path: Optional[str] = None) -> list[Constraint]:
    path_str = config_path or os.environ.get(_ENV_VAR)
    if path_str:
        path = Path(path_str)
    else:
        path = _DEFAULT_CONFIG_PATH

    if not path.exists():
        logger.warning("Epistemic config not found at %s — returning empty constraints", path)
        return []

    try:
        import yaml
    except ImportError:
        logger.warning("PyYAML not installed — returning empty constraints")
        return []

    raw = yaml.safe_load(path.read_text())
    if not raw or "constraints" not in raw:
        logger.warning("No constraints found in %s", path)
        return []

    constraints: list[Constraint] = []
    for item in raw["constraints"]:
        cid = item.get("id", "")
        if not cid:
            continue
        constraints.append(Constraint(
            id=cid,
            description=item.get("description", ""),
            statement=item.get("statement", ""),
            severity=_parse_severity(item.get("severity", "warn")),
            supported_by=item.get("supported_by", []),
            attacked_by=item.get("attacked_by", []),
        ))

    logger.info("Loaded %d epistemic constraints from %s", len(constraints), path)
    return constraints


@lru_cache(maxsize=1)
def get_constraints(config_path: Optional[str] = None) -> list[Constraint]:
    return load_constraints(config_path)
