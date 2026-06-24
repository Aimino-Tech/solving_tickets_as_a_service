"""Tests for agents app — AgentRun model + pipeline tasks."""
from unittest.mock import patch

from django.test import TestCase

from webhooks.models import WebhookEvent

from .models import AgentRun


class AgentRunModelTest(TestCase):
    def test_create_agent_run(self):
        run = AgentRun.objects.create(
            issue_url="https://github.com/owner/repo/issues/1",
            issue_number=1,
            repo_full_name="owner/repo",
            repo_url="https://github.com/owner/repo.git",
            installation_id="123",
        )
        self.assertEqual(run.status, AgentRun.Status.QUEUED)
        self.assertIsNotNone(run.created_at)
        self.assertIsNone(run.completed_at)
        self.assertEqual(str(run), "owner/repo#1 (queued)")

    def test_agent_run_with_webhook_event(self):
        event = WebhookEvent.objects.create(
            source=WebhookEvent.Source.GITHUB,
            event_type="issues",
            delivery_id="del-001",
            payload={"action": "labeled"},
        )
        run = AgentRun.objects.create(
            issue_url="https://github.com/owner/repo/issues/2",
            issue_number=2,
            repo_full_name="owner/repo",
            installation_id="456",
            webhook_event=event,
        )
        self.assertEqual(run.webhook_event, event)

    def test_agent_run_status_transition(self):
        run = AgentRun.objects.create(
            issue_url="https://github.com/owner/repo/issues/3",
            issue_number=3,
            repo_full_name="owner/repo",
            installation_id="789",
        )
        run.status = AgentRun.Status.TRIAGE
        run.save()
        run.refresh_from_db()
        self.assertEqual(run.status, AgentRun.Status.TRIAGE)

        run.status = AgentRun.Status.COMPLETED
        run.save()
        run.refresh_from_db()
        self.assertEqual(run.status, AgentRun.Status.COMPLETED)

    def test_repo_full_name_index(self):
        AgentRun.objects.create(
            issue_url="https://github.com/a/b/issues/1",
            issue_number=1,
            repo_full_name="a/b",
            installation_id="1",
        )
        AgentRun.objects.create(
            issue_url="https://github.com/a/b/issues/2",
            issue_number=2,
            repo_full_name="a/b",
            installation_id="1",
        )


class AgentPipelineTaskTest(TestCase):
    @patch("agents.tasks.triage_issue.s")
    def test_run_issue_pipeline_creates_run(self, mock_triage):
        from agents.tasks import run_issue_pipeline

        result = run_issue_pipeline(
            issue_url="https://github.com/owner/repo/issues/1",
            issue_number=1,
            repo_full_name="owner/repo",
            repo_url="https://github.com/owner/repo.git",
            installation_id="123",
        )
        self.assertIn("run_id", result)
        self.assertEqual(result["status"], "triage")
        self.assertEqual(AgentRun.objects.count(), 1)
