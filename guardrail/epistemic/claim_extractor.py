"""
Simple claim extractor: decomposes response text into factual claims.
"""
from __future__ import annotations

import re
from typing import Optional

from guardrail.epistemic.types import Claim


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

_MIN_CLAIM_LENGTH = 15


def extract_claims(text: str) -> list[Claim]:
    if not text or not isinstance(text, str):
        return []
    sentences = _SENTENCE_SPLIT.split(text.strip())
    claims: list[Claim] = []
    for sentence in sentences:
        cleaned = sentence.strip()
        if len(cleaned) < _MIN_CLAIM_LENGTH:
            continue
        claims.append(Claim(text=cleaned))
    return claims
