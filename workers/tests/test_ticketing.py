"""Tests for workers/support/ticketing -- Jira Service Management integration."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from workers.support.ticketing import (
    CommentResult,
    TicketResult,
    _normalize_timestamp,
    _parse_comment_response,
    _parse_ticket_response,
    add_comment,
    check_config,
    create_ticket,
    get_ticket,
    list_request_types,
)


# ===================================================================
# TicketResult
# ===================================================================


class TestTicketResult:
    def test_fallback_returns_empty(self):
        fb = TicketResult.fallback()
        assert fb.issue_key == ""
        assert fb.errors == []
        assert fb.is_valid is False

    def test_is_valid_true_with_key(self):
        t = TicketResult(issue_key="PROJ-123")
        assert t.is_valid is True

    def test_is_valid_false_without_key(self):
        t = TicketResult()
        assert t.is_valid is False


# ===================================================================
# CommentResult
# ===================================================================


class TestCommentResult:
    def test_fallback_returns_empty(self):
        fb = CommentResult.fallback()
        assert fb.comment_id == ""
        assert fb.errors == []
        assert fb.is_valid is False

    def test_is_valid_true_with_id(self):
        c = CommentResult(comment_id="12345")
        assert c.is_valid is True

    def test_is_valid_false_without_id(self):
        c = CommentResult()
        assert c.is_valid is False


# ===================================================================
# _parse_ticket_response
# ===================================================================


class TestParseTicketResponse:
    def test_parses_basic_fields(self):
        data = {
            "issueKey": "JSM-1",
            "requestFieldValues": {
                "summary": "Need help",
                "description": "Can't log in",
            },
            "currentStatus": {"status": "Waiting for Support"},
            "issueType": {"name": "Help"},
            "createdDate": "2025-01-15T10:00:00Z",
            "updatedDate": "2025-01-15T12:00:00Z",
        }
        result = _parse_ticket_response(data, "1")
        assert result.issue_key == "JSM-1"
        assert result.summary == "Need help"
        assert result.description == "Can't log in"
        assert result.status == "Waiting for Support"
        assert result.request_type == "Help"
        assert result.service_desk_id == "1"
        assert "2025-01-15" in result.created_at

    def test_handles_alternative_field_names(self):
        data = {
            "key": "ALT-2",
            "summary": "Alt summary",
            "description": "Alt desc",
            "currentStatus": {"name": "Open"},
            "type": {"name": "Bug"},
            "createdAt": "2025-02-01T00:00:00Z",
            "updatedAt": "2025-02-01T01:00:00Z",
        }
        result = _parse_ticket_response(data, "")
        assert result.issue_key == "ALT-2"
        assert result.status == "Open"
        assert result.request_type == "Bug"

    def test_handles_empty_data(self):
        result = _parse_ticket_response({}, "")
        assert result.issue_key == ""
        assert result.status == ""
        assert result.request_type == ""

    def test_handles_nested_status(self):
        data = {
            "issueKey": "JSM-3",
            "currentStatus": {"status": "In Progress"},
        }
        result = _parse_ticket_response(data, "")
        assert result.status == "In Progress"

    def test_preserves_raw_data(self):
        data = {"issueKey": "JSM-4", "custom_field": "value"}
        result = _parse_ticket_response(data, "")
        assert result.raw == data


# ===================================================================
# _parse_comment_response
# ===================================================================


class TestParseCommentResponse:
    def test_parses_public_comment(self):
        data = {"id": "101", "created": "2025-01-15T10:30:00Z"}
        result = _parse_comment_response(data, "JSM-1", is_internal=False)
        assert result.comment_id == "101"
        assert result.issue_key == "JSM-1"
        assert result.is_internal is False
        assert "2025-01-15" in result.created_at

    def test_parses_internal_note(self):
        data = {"commentId": "202", "createdAt": "2025-01-15T11:00:00Z"}
        result = _parse_comment_response(data, "JSM-2", is_internal=True)
        assert result.comment_id == "202"
        assert result.is_internal is True

    def test_handles_empty_response(self):
        result = _parse_comment_response({}, "JSM-3", is_internal=False)
        assert result.comment_id == ""
        assert result.created_at == ""


# ===================================================================
# _normalize_timestamp
# ===================================================================


class TestNormalizeTimestamp:
    def test_iso_timestamp_passed_through(self):
        assert _normalize_timestamp("2025-01-15T10:00:00Z") == "2025-01-15T10:00:00Z"

    def test_epoch_millis_format(self):
        result = _normalize_timestamp("/Date(1700000000000+0000)/")
        # 1700000000000 ms = 1700000000 seconds = 2023-11-14T23:13:20
        assert "2023-11-14" in result

    def test_epoch_millis_with_negative_offset(self):
        result = _normalize_timestamp("/Date(1700000000000-0500)/")
        assert result != ""

    def test_empty_string(self):
        assert _normalize_timestamp("") == ""

    def test_malformed_epoch_returns_as_is(self):
        result = _normalize_timestamp("/Date(invalid)/")
        assert result is not None

    def test_rfc_3339_timestamp(self):
        ts = "2025-06-01T15:30:00+00:00"
        assert _normalize_timestamp(ts) == ts


# ===================================================================
# create_ticket
# ===================================================================


class TestCreateTicket:
    @patch("workers.support.ticketing.httpx.Client")
    def test_creates_ticket_successfully(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "issueKey": "PROJ-123",
            "requestFieldValues": {"summary": "Test ticket", "description": "Desc"},
            "currentStatus": {"status": "Open"},
            "issueType": {"name": "Help"},
            "createdDate": "2025-01-15T10:00:00Z",
            "updatedDate": "2025-01-15T10:00:00Z",
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test ticket",
                description="Desc",
                service_desk_id="1",
                request_type_id="10",
            )

        assert result.issue_key == "PROJ-123"
        assert result.summary == "Test ticket"
        assert result.status == "Open"
        assert result.is_valid is True

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/rest/servicedeskapi/servicedesk/1/request" in call_args[0][0]
        payload = call_args[1]["json"]
        assert payload["serviceDeskId"] == "1"
        assert payload["requestTypeId"] == "10"
        assert payload["requestFieldValues"]["summary"] == "Test ticket"

    def test_missing_credentials_returns_fallback(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test",
                service_desk_id="1",
                request_type_id="10",
            )
            assert result.is_valid is False
            assert len(result.errors) >= 1
            assert "credentials" in result.errors[0].lower()

    def test_missing_service_desk_id_returns_fallback(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test",
                service_desk_id=None,
                request_type_id="10",
            )
            assert result.is_valid is False
            assert any("service_desk_id" in err.lower() for err in result.errors)

    def test_missing_request_type_returns_fallback(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test",
                service_desk_id="1",
                request_type_id=None,
            )
            assert result.is_valid is False
            assert any("request_type_id" in err.lower() for err in result.errors)

    @patch("workers.support.ticketing.httpx.Client")
    def test_raises_on_auth_error(self, mock_client_cls):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            with pytest.raises(ValueError, match="credentials"):
                tk.create_ticket(
                    summary="Test",
                    service_desk_id="1",
                    request_type_id="10",
                    raise_on_auth_error=True,
                )

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_http_error(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "400 Bad Request",
            request=MagicMock(),
            response=MagicMock(status_code=400, text="Bad request body"),
        )
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test",
                service_desk_id="1",
                request_type_id="10",
            )

        assert result.is_valid is False
        assert len(result.errors) >= 1

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_request_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.post.side_effect = httpx.RequestError("Connection refused")
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.create_ticket(
                summary="Test",
                service_desk_id="1",
                request_type_id="10",
            )
        assert result.is_valid is False
        assert len(result.errors) >= 1

    @patch("workers.support.ticketing.httpx.Client")
    def test_includes_extra_fields(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "issueKey": "PROJ-456",
            "requestFieldValues": {
                "summary": "With extras",
                "description": "Desc",
                "priority": "high",
            },
            "currentStatus": {"status": "Open"},
            "issueType": {"name": "Bug"},
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            tk.create_ticket(
                summary="With extras",
                description="Desc",
                service_desk_id="1",
                request_type_id="10",
                extra_fields={"priority": "high"},
            )

        call_payload = mock_client.post.call_args[1]["json"]
        assert call_payload["requestFieldValues"]["priority"] == "high"


# ===================================================================
# get_ticket
# ===================================================================


class TestGetTicket:
    @patch("workers.support.ticketing.httpx.Client")
    def test_gets_ticket_successfully(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "issueKey": "PROJ-789",
            "requestFieldValues": {"summary": "Existing ticket", "description": "Issue description"},
            "currentStatus": {"status": "In Progress"},
            "issueType": {"name": "Bug"},
            "createdDate": "2025-03-01T08:00:00Z",
        }
        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.get_ticket("PROJ-789")

        assert result.issue_key == "PROJ-789"
        assert result.status == "In Progress"
        assert result.is_valid is True

        call_url = mock_client.get.call_args[0][0]
        assert "PROJ-789" in call_url
        assert "/rest/servicedeskapi/request/" in call_url

    def test_missing_credentials_returns_fallback(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.get_ticket("PROJ-789")
            assert result.is_valid is False
            assert len(result.errors) >= 1

    def test_empty_issue_key_returns_fallback(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.get_ticket("")
            assert result.is_valid is False
            assert len(result.errors) >= 1

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_http_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "404 Not Found",
            request=MagicMock(),
            response=MagicMock(status_code=404, text="Not found"),
        )
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.get_ticket("PROJ-999")
            assert result.is_valid is False
            assert len(result.errors) >= 1

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_request_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.RequestError("Timeout")
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.get_ticket("PROJ-999")
            assert result.is_valid is False
            assert len(result.errors) >= 1


# ===================================================================
# add_comment
# ===================================================================


class TestAddComment:
    @patch("workers.support.ticketing.httpx.Client")
    def test_adds_public_comment(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "id": "1001",
            "created": "2025-04-01T09:00:00Z",
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("PROJ-123", "This is a public comment", is_internal=False)

        assert result.comment_id == "1001"
        assert result.issue_key == "PROJ-123"
        assert result.is_internal is False
        assert result.is_valid is True

        payload = mock_client.post.call_args[1]["json"]
        assert payload["body"] == "This is a public comment"
        assert payload["public"] is True

    @patch("workers.support.ticketing.httpx.Client")
    def test_adds_internal_note(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "id": "1002",
            "created": "2025-04-01T09:30:00Z",
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("PROJ-123", "Internal investigation note", is_internal=True)

        assert result.comment_id == "1002"
        assert result.is_internal is True
        payload = mock_client.post.call_args[1]["json"]
        assert payload["public"] is False

    def test_missing_credentials_returns_fallback(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("PROJ-123", "Comment")
            assert result.is_valid is False
            assert len(result.errors) >= 1

    def test_empty_issue_key_returns_fallback(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("", "Comment")
            assert result.is_valid is False

    def test_empty_body_returns_fallback(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("PROJ-123", "")
            assert result.is_valid is False

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_http_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.post.side_effect = httpx.HTTPStatusError(
            "403 Forbidden",
            request=MagicMock(),
            response=MagicMock(status_code=403, text="Forbidden"),
        )
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.add_comment("PROJ-123", "Comment")
            assert result.is_valid is False
            assert len(result.errors) >= 1


# ===================================================================
# list_request_types
# ===================================================================


class TestListRequestTypes:
    @patch("workers.support.ticketing.httpx.Client")
    def test_lists_request_types(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "values": [
                {
                    "id": "10",
                    "name": "Help",
                    "description": "Get help from support",
                    "group": "Default",
                    "issueType": {"name": "Service Request"},
                },
                {
                    "id": "11",
                    "name": "Bug Report",
                    "description": "Report a bug",
                    "group": "Default",
                    "issueType": {"name": "Bug"},
                },
            ],
        }
        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
            "JSM_DEFAULT_SERVICE_DESK_ID": "1",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            types = tk.list_request_types(service_desk_id="1")

        assert len(types) == 2
        assert types[0].name == "Help"
        assert types[0].id == "10"
        assert types[0].issue_type_name == "Service Request"
        assert types[1].name == "Bug Report"
        assert types[1].issue_type_name == "Bug"

    def test_missing_credentials_returns_empty(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.list_request_types(service_desk_id="1")
            assert result == []

    def test_missing_service_desk_returns_empty(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.list_request_types(service_desk_id=None)
            assert result == []

    @patch("workers.support.ticketing.httpx.Client")
    def test_handles_api_error_gracefully(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500, text="Server error"),
        )
        mock_client_cls.return_value.__enter__.return_value = mock_client

        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "token123",
            "JSM_API_BASE": "https://test.atlassian.net",
            "JSM_DEFAULT_SERVICE_DESK_ID": "1",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            result = tk.list_request_types()
            assert result == []


# ===================================================================
# check_config
# ===================================================================


class TestCheckConfig:
    def test_returns_issues_when_unconfigured(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            issues = tk.check_config()
            assert len(issues) >= 3
            assert any("JSM_API_BASE" in i for i in issues)
            assert any("JSM_EMAIL" in i for i in issues)
            assert any("JSM_API_TOKEN" in i for i in issues)

    def test_returns_no_issues_when_configured(self):
        with patch.dict("os.environ", {
            "JSM_API_BASE": "https://test.atlassian.net",
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "valid_token",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            issues = tk.check_config()
            assert issues == []

    def test_reports_missing_base(self):
        with patch.dict("os.environ", {
            "JSM_EMAIL": "user@test.com",
            "JSM_API_TOKEN": "valid_token",
        }, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            issues = tk.check_config()
            assert any("JSM_API_BASE" in i for i in issues)


# ===================================================================
# Module imports
# ===================================================================


class TestModuleImports:
    def test_module_imports_from_package(self):
        from workers.support import (
            CommentResult as CR,
            TicketResult as TR,
            add_comment as ac,
            check_config as cc,
            create_ticket as ct,
            get_ticket as gt,
            list_request_types as lrt,
        )

        assert callable(ct)
        assert callable(gt)
        assert callable(ac)
        assert callable(lrt)
        assert callable(cc)
        assert CR is CommentResult
        assert TR is TicketResult


# ===================================================================
# Env-var defaults
# ===================================================================


class TestEnvDefaults:
    def test_default_timeout(self):
        with patch.dict("os.environ", {}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            assert tk.JSM_REQUEST_TIMEOUT_SECONDS == 30

    def test_custom_timeout(self):
        with patch.dict("os.environ", {"JSM_REQUEST_TIMEOUT_SECONDS": "60"}, clear=True):
            import importlib
            import workers.support.ticketing as tk
            importlib.reload(tk)

            assert tk.JSM_REQUEST_TIMEOUT_SECONDS == 60
