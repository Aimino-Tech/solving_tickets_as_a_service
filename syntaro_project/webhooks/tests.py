"""Tests for webhooks app — GitHub webhook HMAC verification + event processing."""
import hashlib
import hmac
import json
from unittest.mock import patch

from django.conf import settings
from django.test import Client, TestCase, override_settings

from .models import WebhookEvent

TEST_SECRET = "test-secret-123"
SAMPLE_PAYLOAD = {
    "action": "labeled",
    "issue": {
        "number": 42,
        "html_url": "https://github.com/owner/repo/issues/42",
    },
    "label": {"name": "syntaro:fix"},
    "repository": {
        "full_name": "owner/repo",
        "clone_url": "https://github.com/owner/repo.git",
        "owner": {"login": "owner"},
        "name": "repo",
    },
    "sender": {"login": "test-user"},
    "installation": {"id": 12345},
}


def _sign(payload: dict, secret: str = TEST_SECRET) -> str:
    body = json.dumps(payload).encode()
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return expected


def _headers(payload: dict, event: str = "issues", delivery: str = "test-delivery") -> dict:
    return {
        "HTTP_X_GITHUB_EVENT": event,
        "HTTP_X_GITHUB_DELIVERY": delivery,
        "HTTP_X_HUB_SIGNATURE_256": _sign(payload),
    }


def _post(url: str, payload: dict, **extras):
    body = json.dumps(payload)
    return Client().post(url, data=body, content_type="application/json", **extras)


@override_settings(
    GITHUB_WEBHOOK_SECRET=TEST_SECRET,
    SYNTARO_LABEL="syntaro:fix",
)
class GitHubWebhookTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_valid_signature_returns_200(self):
        resp = _post("/webhook/github", SAMPLE_PAYLOAD, **_headers(SAMPLE_PAYLOAD))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"OK")

    def test_invalid_signature_returns_400(self):
        resp = self.client.post(
            "/webhook/github",
            data=json.dumps(SAMPLE_PAYLOAD),
            content_type="application/json",
            HTTP_X_GITHUB_EVENT="issues",
            HTTP_X_GITHUB_DELIVERY="test-delivery-002",
            HTTP_X_HUB_SIGNATURE_256="sha256=invalid",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn(b"Signature", resp.content)

    def test_creates_webhook_event(self):
        resp = _post("/webhook/github", SAMPLE_PAYLOAD, **_headers(SAMPLE_PAYLOAD))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(WebhookEvent.objects.count(), 1)
        event = WebhookEvent.objects.first()
        self.assertEqual(event.source, WebhookEvent.Source.GITHUB)
        self.assertEqual(event.event_type, "issues")
        self.assertEqual(event.delivery_id, "test-delivery")
        self.assertEqual(event.payload["action"], "labeled")

    @patch("webhooks.views._handle_issue_labeled")
    def test_labeled_action_triggers_dispatch(self, mock_handle):
        resp = _post("/webhook/github", SAMPLE_PAYLOAD, **_headers(SAMPLE_PAYLOAD))
        self.assertEqual(resp.status_code, 200)
        mock_handle.assert_called_once()

    @patch("webhooks.views._handle_issue_labeled")
    def test_unlabeled_action_does_not_trigger_dispatch(self, mock_handle):
        payload = {**SAMPLE_PAYLOAD, "action": "unlabeled"}
        resp = _post("/webhook/github", payload, **_headers(payload))
        self.assertEqual(resp.status_code, 200)
        mock_handle.assert_not_called()

    @patch("webhooks.views._handle_issue_labeled")
    def test_opened_action_does_not_trigger_dispatch(self, mock_handle):
        payload = {**SAMPLE_PAYLOAD, "action": "opened"}
        resp = _post("/webhook/github", payload, **_headers(payload))
        self.assertEqual(resp.status_code, 200)
        mock_handle.assert_not_called()

    @override_settings(GITHUB_WEBHOOK_SECRET="")
    def test_missing_secret_skips_verification(self):
        resp = self.client.post(
            "/webhook/github",
            data=json.dumps(SAMPLE_PAYLOAD),
            content_type="application/json",
            HTTP_X_GITHUB_EVENT="issues",
            HTTP_X_GITHUB_DELIVERY="test-delivery-003",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(WebhookEvent.objects.count(), 1)

    def test_non_issues_event_creates_event_no_dispatch(self):
        payload = {"action": "created", "issue": {"number": 1}}
        resp = _post("/webhook/github", payload, **_headers(payload, event="issue_comment"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(WebhookEvent.objects.count(), 1)


class WebhookEventModelTest(TestCase):
    def test_create_event(self):
        event = WebhookEvent.objects.create(
            source=WebhookEvent.Source.GITHUB,
            event_type="push",
            delivery_id="del-001",
            payload={"ref": "refs/heads/main"},
        )
        self.assertEqual(event.status, WebhookEvent.Status.PENDING)
        self.assertIsNotNone(event.created_at)
        self.assertEqual(str(event), "[github] push (pending)")

    def test_event_defaults(self):
        event = WebhookEvent.objects.create(
            source=WebhookEvent.Source.GITLAB,
            event_type="merge_request",
            payload={"object_kind": "merge_request"},
        )
        self.assertIsNone(event.delivery_id)
        self.assertEqual(event.retry_count, 0)
        self.assertEqual(event.status, WebhookEvent.Status.PENDING)
