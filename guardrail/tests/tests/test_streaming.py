"""
Tests for streaming mode correction/annotation in SlopIntentGuardrail.
"""
import json
import os
import sys

import pytest

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from typing import Any, AsyncGenerator, AsyncIterator
from guardrail.slop_guardrail import SlopIntentGuardrail, SlopIntentGuardrailError


class MockChunk:
    def __init__(self, content: str = ""):
        self.choices = [MockChoice(content)] if content else []


class MockChoice:
    def __init__(self, content: str = ""):
        self.delta = MockDelta(content)


class MockDelta:
    def __init__(self, content: str = ""):
        self.content = content


async def _mock_stream(chunks: list[str]) -> AsyncGenerator:
    for c in chunks:
        yield MockChunk(c)


SLOP_TEXT = (
    "The user wants a payment function. "
    "I'll stub this out for now. "
    "Let me mock it."
)


def _make_response_gen(chunks: list[str]) -> AsyncGenerator:
    async def gen():
        for c in chunks:
            yield MockChunk(c)
    return gen()


@pytest.mark.asyncio
async def test_streaming_warn_mode_logs_only():
    g = SlopIntentGuardrail(gate_mode="warn")
    stream = _make_response_gen([SLOP_TEXT])
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 1
    assert "CAUTION" not in (results[0].choices[0].delta.content or "")


@pytest.mark.asyncio
async def test_streaming_annotate_injects_caution():
    g = SlopIntentGuardrail(gate_mode="annotate")
    stream = _make_response_gen([SLOP_TEXT])
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 1
    content = results[0].choices[0].delta.content or ""
    assert "CAUTION" in content
    assert "Slop pattern detected" in content


@pytest.mark.asyncio
async def test_streaming_block_raises_error():
    g = SlopIntentGuardrail(gate_mode="block")
    stream = _make_response_gen([SLOP_TEXT])
    results = []
    with pytest.raises(SlopIntentGuardrailError):
        async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
            results.append(chunk)
    assert len(results) == 1


@pytest.mark.asyncio
async def test_streaming_clean_content_no_annotation():
    g = SlopIntentGuardrail(gate_mode="annotate")
    stream = _make_response_gen(["The capital of France is Paris."])
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 1
    content = results[0].choices[0].delta.content or ""
    assert "CAUTION" not in content


@pytest.mark.asyncio
async def test_streaming_multiple_chunks_annotation_on_slop():
    g = SlopIntentGuardrail(gate_mode="annotate")
    chunks = [
        "The user wants a payment ",
        "function. I'll stub this ",
        "out for now and implement later.",
    ]
    stream = _make_response_gen(chunks)
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 3
    second_content = results[1].choices[0].delta.content or ""
    assert "CAUTION" in second_content


@pytest.mark.asyncio
async def test_streaming_chunks_preserved_in_order():
    g = SlopIntentGuardrail(gate_mode="warn")
    chunks = ["Hello ", "world ", "here."]
    stream = _make_response_gen(chunks)
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 3
    full = "".join(c.choices[0].delta.content or "" for c in results)
    assert full == "Hello world here."


@pytest.mark.asyncio
async def test_streaming_empty_chunks():
    g = SlopIntentGuardrail()
    stream = _make_response_gen([])
    results = []
    async for chunk in g.async_post_call_streaming_iterator_hook(None, stream, {}):
        results.append(chunk)
    assert len(results) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
