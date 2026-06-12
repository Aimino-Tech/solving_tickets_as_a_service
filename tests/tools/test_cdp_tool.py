"""Tests for tools.browser_cdp_tool - CDP flatten=True fix.

Tests the health check, target attachment with flatten fallback,
auto-reconnect, and the sync browser_cdp wrapper. All tests mock
the WebSocket layer so they run without a live browser.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


def _make_mock_ws(responses: list[dict] | None = None):
    """Create a mock WebSocket with canned recv responses.

    Parameters
    ----------
    responses : list[dict], optional
        List of JSON-serializable dicts to return from ``recv()``, in order.
        When exhausted, ``recv()`` raises asyncio.TimeoutError.

    Returns
    -------
    AsyncMock
        A mock with ``send``, ``recv``, and ``close`` async methods.
    """
    ws = AsyncMock()
    ws.send = AsyncMock()

    response_queue = list(responses) if responses else []

    async def _recv():
        if response_queue:
            return json.dumps(response_queue.pop(0))
        # Simulate a real network timeout: sleep so the caller's
        # asyncio.wait_for timeout fires with the expected message.
        await asyncio.sleep(10)
        raise asyncio.TimeoutError("recv timed out")

    ws.recv = AsyncMock(side_effect=_recv)
    ws.close = AsyncMock()
    return ws


def _patch_websockets_connect(mock_ws):
    """Patch ``tools.browser_cdp_tool.websockets.connect`` to yield *mock_ws*.

    Returns the patcher so the caller can ``start()/stop()`` or use as a
    context manager (``with _patch_websockets_connect(ws):``).
    """
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=mock_ws)
    cm.__aexit__ = AsyncMock(return_value=None)

    return patch(
        "tools.browser_cdp_tool.websockets.connect",
        return_value=cm,
    )


# ===================================================================
# _health_check
# ===================================================================


class TestHealthCheck:
    """Unit tests for the ``_health_check`` helper."""

    @pytest.mark.asyncio
    async def test_returns_true_on_success(self):
        from tools.browser_cdp_tool import _health_check

        ws = _make_mock_ws([
            {"id": 9999, "result": {
                "product": "Chrome/120.0.0.0",
                "protocolVersion": "1.3",
                "userAgent": "Mozilla/5.0",
            }},
        ])

        result = await _health_check(ws)
        assert result is True

        # Verify sent message
        ws.send.assert_called_once()
        sent = json.loads(ws.send.call_args[0][0])
        assert sent["method"] == "Browser.getVersion"
        assert sent["id"] == 9999

    @pytest.mark.asyncio
    async def test_returns_false_on_timeout(self):
        from tools.browser_cdp_tool import _health_check

        ws = _make_mock_ws([])  # No responses → timeout

        result = await _health_check(ws)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_error_response(self):
        from tools.browser_cdp_tool import _health_check

        ws = _make_mock_ws([
            {"id": 9999, "error": {"code": -32000, "message": "Not available"}},
        ])

        result = await _health_check(ws)
        assert result is False

    @pytest.mark.asyncio
    async def test_skips_events(self):
        """Events (messages without an ``id`` field) should be ignored."""
        from tools.browser_cdp_tool import _health_check

        ws = _make_mock_ws([
            {"method": "Target.attachedToTarget", "params": {}},  # Event
            {"id": 9999, "result": {"product": "Chrome"}},
        ])

        result = await _health_check(ws)
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_wrong_id(self):
        """Messages with a non-matching id should be ignored."""
        from tools.browser_cdp_tool import _health_check

        ws = _make_mock_ws([
            {"id": 1111, "result": {"product": "Other"}},  # Wrong ID
            {"id": 9999, "result": {"product": "Chrome"}},
        ])

        result = await _health_check(ws)
        assert result is True  # Second response with correct ID

    @pytest.mark.asyncio
    async def test_send_raise_is_caught(self):
        from tools.browser_cdp_tool import _health_check

        ws = AsyncMock()
        ws.send = AsyncMock(side_effect=ConnectionError("send failed"))
        ws.recv = AsyncMock()

        result = await _health_check(ws)
        assert result is False


# ===================================================================
# _attach_to_target
# ===================================================================


class TestAttachToTarget:
    """Unit tests for the ``_attach_to_target`` helper."""

    @pytest.mark.asyncio
    async def test_success_flatten_true(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([
            {"id": 1, "result": {"sessionId": "session-abc"}},
        ])

        session_id, next_id = await _attach_to_target(
            ws, "target-1", 30.0, 1, flatten=True,
        )
        assert session_id == "session-abc"
        assert next_id == 2

        sent = json.loads(ws.send.call_args[0][0])
        assert sent["method"] == "Target.attachToTarget"
        assert sent["params"]["targetId"] == "target-1"
        assert sent["params"]["flatten"] is True

    @pytest.mark.asyncio
    async def test_success_flatten_false(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([
            {"id": 5, "result": {"sessionId": "session-xyz"}},
        ])

        session_id, next_id = await _attach_to_target(
            ws, "target-2", 30.0, 5, flatten=False,
        )
        assert session_id == "session-xyz"
        assert next_id == 6

        sent = json.loads(ws.send.call_args[0][0])
        assert sent["params"]["flatten"] is False

    @pytest.mark.asyncio
    async def test_error_response_raises(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([
            {"id": 1, "error": {"code": -32000, "message": "Target not found"}},
        ])

        with pytest.raises(RuntimeError, match="Target.attachToTarget.*flatten=True"):
            await _attach_to_target(ws, "target-1", 30.0, 1, flatten=True)

    @pytest.mark.asyncio
    async def test_missing_session_id_raises(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([
            {"id": 1, "result": {"something": "else"}},
        ])

        with pytest.raises(RuntimeError, match="did not return a sessionId"):
            await _attach_to_target(ws, "target-1", 30.0, 1, flatten=True)

    @pytest.mark.asyncio
    async def test_timeout_raises(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([])  # No responses

        with pytest.raises(TimeoutError, match="Timed out attaching"):
            await _attach_to_target(ws, "target-1", 0.1, 1, flatten=True)

    @pytest.mark.asyncio
    async def test_ignores_events(self):
        from tools.browser_cdp_tool import _attach_to_target

        ws = _make_mock_ws([
            {"method": "Target.attachedToTarget", "params": {}},  # Event
            {"id": 1, "result": {"sessionId": "session-evt"}},
        ])

        session_id, next_id = await _attach_to_target(
            ws, "target-1", 30.0, 1, flatten=True,
        )
        assert session_id == "session-evt"
        assert next_id == 2


# ===================================================================
# _cdp_call
# ===================================================================


class TestCdpCall:
    """Tests for ``_cdp_call`` — the core async CDP caller."""

    # -- browser-level (no target_id) ---------------------------------------

    @pytest.mark.asyncio
    async def test_browser_level_method(self):
        """A browser-level call (no target_id) should work without attach."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            {"id": 1, "result": {"product": "Chrome/120"}},
        ])

        with _patch_websockets_connect(ws):
            result = await _cdp_call(
                "ws://localhost:9222", "Browser.getVersion", {}, None, 30.0,
            )

        assert result == {"product": "Chrome/120"}
        assert ws.send.call_count == 1
        sent = json.loads(ws.send.call_args[0][0])
        assert sent["id"] == 1
        assert sent["method"] == "Browser.getVersion"
        assert "sessionId" not in sent

    # -- page-level with flatten=True ---------------------------------------

    @pytest.mark.asyncio
    async def test_page_level_with_flatten_true(self):
        """Page-level method with successful flatten=True attach."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            # Attach response
            {"id": 1, "result": {"sessionId": "session-123"}},
            # Health check response
            {"id": 9999, "result": {"product": "Chrome/120"}},
            # Actual method response
            {"id": 2, "result": {"result": {"type": "string", "value": "hello"}}},
        ])

        with _patch_websockets_connect(ws):
            result = await _cdp_call(
                "ws://localhost:9222",
                "Runtime.evaluate",
                {"expression": "'hello'"},
                "target-1",
                30.0,
            )

        assert result == {"result": {"type": "string", "value": "hello"}}

        # Verify message order
        send_calls = ws.send.call_args_list
        assert len(send_calls) == 3  # attach + health + method

        # 1st message: attachToTarget with flatten=True
        msg1 = json.loads(send_calls[0][0][0])
        assert msg1["method"] == "Target.attachToTarget"
        assert msg1["params"]["flatten"] is True

        # 2nd message: health check (Browser.getVersion)
        msg2 = json.loads(send_calls[1][0][0])
        assert msg2["method"] == "Browser.getVersion"

        # 3rd message: actual method with sessionId
        msg3 = json.loads(send_calls[2][0][0])
        assert msg3["method"] == "Runtime.evaluate"
        assert msg3["sessionId"] == "session-123"

    # -- fallback to flatten=False ------------------------------------------

    @pytest.mark.asyncio
    async def test_fallback_to_flatten_false(self):
        """When flatten=True fails, should retry with flatten=False."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            # 1st attach: flatten=True fails
            {"id": 1, "error": {"code": -32000, "message": "flatten not supported"}},
            # 2nd attach: flatten=False succeeds
            {"id": 2, "result": {"sessionId": "session-456"}},
            # Health check
            {"id": 9999, "result": {"product": "Chrome/120"}},
            # Actual method
            {"id": 3, "result": {"result": {"type": "string", "value": "world"}}},
        ])

        with _patch_websockets_connect(ws):
            result = await _cdp_call(
                "ws://localhost:9222",
                "Runtime.evaluate",
                {"expression": "'world'"},
                "target-2",
                30.0,
            )

        assert result == {"result": {"type": "string", "value": "world"}}

        send_calls = ws.send.call_args_list
        assert len(send_calls) == 4

        # flatten=True attempt
        assert json.loads(send_calls[0][0][0])["params"]["flatten"] is True
        # flatten=False retry
        assert json.loads(send_calls[1][0][0])["params"]["flatten"] is False

    @pytest.mark.asyncio
    async def test_both_flatten_modes_fail(self):
        """When both flatten=True and flatten=False fail, raise."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            # 1st attach: flatten=True fails
            {"id": 1, "error": {"code": -32000, "message": "target not found"}},
            # 2nd attach: flatten=False also fails
            {"id": 2, "error": {"code": -32000, "message": "target not found"}},
        ])

        with _patch_websockets_connect(ws):
            with pytest.raises(RuntimeError, match="Target.attachToTarget"):
                await _cdp_call(
                    "ws://localhost:9222",
                    "Runtime.evaluate",
                    {},
                    "target-gone",
                    30.0,
                )

    # -- health check failure -----------------------------------------------

    @pytest.mark.asyncio
    async def test_proceeds_after_health_check_failure(self):
        """A failed health check should log a warning but still proceed."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            {"id": 1, "result": {"sessionId": "session-789"}},
            # Health check returns error
            {"id": 9999, "error": {"code": -32000, "message": "timeout"}},
            # Actual method still works
            {"id": 2, "result": {"ok": True}},
        ])

        with _patch_websockets_connect(ws):
            result = await _cdp_call(
                "ws://localhost:9222",
                "Runtime.evaluate",
                {"expression": "42"},
                "target-3",
                30.0,
            )

        assert result == {"ok": True}

    # -- auto-reconnect -----------------------------------------------------

    @pytest.mark.asyncio
    async def test_auto_reconnect_on_connection_closed(self):
        """When WebSocket drops, should reconnect and retry once."""
        from tools.browser_cdp_tool import _cdp_call, ConnectionClosed

        # First WebSocket: fails on send
        ws1 = _make_mock_ws()
        ws1.send = AsyncMock(
            side_effect=ConnectionClosed(None, None),
        )

        # Second WebSocket: succeeds
        ws2 = _make_mock_ws([
            {"id": 1, "result": {"product": "Chrome"}},
        ])

        connect_results = [ws1, ws2]

        async def _enter():
            return connect_results.pop(0)

        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(side_effect=_enter)
        cm.__aexit__ = AsyncMock(return_value=None)

        with patch(
            "tools.browser_cdp_tool.websockets.connect",
            return_value=cm,
        ):
            result = await _cdp_call(
                "ws://localhost:9222",
                "Browser.getVersion",
                {},
                None,
                30.0,
            )

        # Should still succeed after retry
        assert result == {"product": "Chrome"}
        # Verify two connections were made
        assert cm.__aenter__.call_count == 2

    @pytest.mark.asyncio
    async def test_auto_reconnect_still_fails_on_second_attempt(self):
        """If retry also fails, the error should propagate."""
        from tools.browser_cdp_tool import _cdp_call, ConnectionClosed

        ws1 = _make_mock_ws()
        ws1.send = AsyncMock(side_effect=ConnectionClosed(None, None))

        ws2 = _make_mock_ws()
        ws2.send = AsyncMock(side_effect=ConnectionClosed(None, None))

        connect_results = [ws1, ws2]

        async def _enter():
            return connect_results.pop(0)

        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(side_effect=_enter)
        cm.__aexit__ = AsyncMock(return_value=None)

        with patch(
            "tools.browser_cdp_tool.websockets.connect",
            return_value=cm,
        ):
            with pytest.raises(ConnectionClosed):
                await _cdp_call(
                    "ws://localhost:9222",
                    "Browser.getVersion",
                    {},
                    None,
                    30.0,
                )

    # -- timeout handling ---------------------------------------------------

    @pytest.mark.asyncio
    async def test_timeout_in_attach_propagates(self):
        """Timeout during attach should propagate as TimeoutError."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([])  # No responses → timeout

        with _patch_websockets_connect(ws):
            with pytest.raises(TimeoutError, match="Timed out attaching"):
                await _cdp_call(
                    "ws://localhost:9222",
                    "Runtime.evaluate",
                    {},
                    "target-slow",
                    0.1,  # Very short timeout
                )

    @pytest.mark.asyncio
    async def test_timeout_in_response_propagates(self):
        """Timeout waiting for method response should propagate."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            {"id": 1, "result": {"sessionId": "s-1"}},
            {"id": 9999, "result": {"product": "Chrome"}},
            # No response for the actual method
        ])

        with _patch_websockets_connect(ws):
            with pytest.raises(TimeoutError, match="Timed out waiting"):
                await _cdp_call(
                    "ws://localhost:9222",
                    "Runtime.evaluate",
                    {},
                    "target-slow",
                    0.1,
                )

    @pytest.mark.asyncio
    async def test_cdp_error_response(self):
        """Error response from the method call should raise."""
        from tools.browser_cdp_tool import _cdp_call

        ws = _make_mock_ws([
            {"id": 1, "error": {"code": -32000, "message": "Not found"}},
        ])

        with _patch_websockets_connect(ws):
            with pytest.raises(RuntimeError, match="CDP error"):
                await _cdp_call(
                    "ws://localhost:9222",
                    "Browser.getVersion",
                    {},
                    None,
                    30.0,
                )


# ===================================================================
# browser_cdp (sync wrapper)
# ===================================================================


class TestBrowserCdpSync:
    """Tests for ``browser_cdp`` — the sync entry point."""

    def test_returns_error_when_no_endpoint(self):
        from tools.browser_cdp_tool import browser_cdp

        with patch(
            "tools.browser_cdp_tool._resolve_cdp_endpoint",
            return_value="",
        ):
            result = browser_cdp(method="Target.getTargets")

        assert "error" in result

    def test_returns_error_when_invalid_method(self):
        from tools.browser_cdp_tool import browser_cdp

        with patch(
            "tools.browser_cdp_tool._resolve_cdp_endpoint",
            return_value="ws://localhost:9222",
        ):
            result = browser_cdp(method="")

        assert "error" in result

    def test_returns_error_when_params_not_dict(self):
        from tools.browser_cdp_tool import browser_cdp

        with patch(
            "tools.browser_cdp_tool._resolve_cdp_endpoint",
            return_value="ws://localhost:9222",
        ):
            result = browser_cdp(method="Target.getTargets", params="not_a_dict")

        assert "error" in result

    def test_returns_error_when_no_websockets(self):
        from tools.browser_cdp_tool import browser_cdp

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            patch("tools.browser_cdp_tool._WS_AVAILABLE", False),
        ):
            result = browser_cdp(method="Target.getTargets")

        assert "error" in result
        assert "websockets" in result.lower()

    def test_successful_browser_level_call(self):
        """End-to-end: sync wrapper should return JSON with success=True."""
        from tools.browser_cdp_tool import browser_cdp

        ws = _make_mock_ws([
            {"id": 1, "result": {"targetInfos": []}},
        ])

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            _patch_websockets_connect(ws),
        ):
            result_str = browser_cdp(method="Target.getTargets")

        result = json.loads(result_str)
        assert result["success"] is True
        assert result["result"]["targetInfos"] == []

    def test_successful_page_level_call_with_target_id(self):
        """End-to-end: sync wrapper with target_id should attach and call."""
        from tools.browser_cdp_tool import browser_cdp

        ws = _make_mock_ws([
            # Attach
            {"id": 1, "result": {"sessionId": "session-p1"}},
            # Health check
            {"id": 9999, "result": {"product": "Chrome"}},
            # Method
            {"id": 2, "result": {"result": {"value": 42}}},
        ])

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            _patch_websockets_connect(ws),
        ):
            result_str = browser_cdp(
                method="Runtime.evaluate",
                params={"expression": "21 + 21"},
                target_id="tab-1",
            )

        result = json.loads(result_str)
        assert result["success"] is True
        assert result["result"]["result"]["value"] == 42
        assert result["target_id"] == "tab-1"

    def test_fallback_flatten_works_in_sync_wrapper(self):
        """The flatten fallback should work end-to-end."""
        from tools.browser_cdp_tool import browser_cdp

        ws = _make_mock_ws([
            # 1st attach: flatten=True fails
            {"id": 1, "error": {"code": -32000, "message": "not supported"}},
            # 2nd attach: flatten=False succeeds
            {"id": 2, "result": {"sessionId": "session-fallback"}},
            # Health check
            {"id": 9999, "result": {"product": "Chrome"}},
            # Method
            {"id": 3, "result": {"result": {"value": "fallback worked"}}},
        ])

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            _patch_websockets_connect(ws),
        ):
            result_str = browser_cdp(
                method="Runtime.evaluate",
                params={"expression": "1 + 1"},
                target_id="tab-fallback",
            )

        result = json.loads(result_str)
        assert result["success"] is True
        assert result["result"]["result"]["value"] == "fallback worked"

    def test_timeout_error_returns_tool_error(self):
        from tools.browser_cdp_tool import browser_cdp

        ws = _make_mock_ws([])  # No responses

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            _patch_websockets_connect(ws),
        ):
            result_str = browser_cdp(
                method="Target.getTargets",
                timeout=0.1,
            )

        result = json.loads(result_str)
        assert "error" in result

    def test_websocket_error_returns_tool_error(self):
        from tools.browser_cdp_tool import browser_cdp, ConnectionClosed

        ws = _make_mock_ws()
        ws.send = AsyncMock(side_effect=ConnectionClosed(None, None))
        ws2 = _make_mock_ws()
        ws2.send = AsyncMock(side_effect=ConnectionClosed(None, None))

        connect_results = [ws, ws2]

        async def _enter():
            return connect_results.pop(0)

        cm = AsyncMock()
        cm.__aenter__ = AsyncMock(side_effect=_enter)
        cm.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "tools.browser_cdp_tool._resolve_cdp_endpoint",
                return_value="ws://localhost:9222",
            ),
            patch(
                "tools.browser_cdp_tool.websockets.connect",
                return_value=cm,
            ),
        ):
            result_str = browser_cdp(method="Target.getTargets")

        result = json.loads(result_str)
        assert "error" in result
