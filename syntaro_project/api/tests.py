"""Tests for api app — health check + admin endpoints."""
from django.test import Client, TestCase


class HealthTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_health_returns_200(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)

    def test_health_returns_json(self):
        resp = self.client.get("/api/health")
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "syntaro-django")
        self.assertEqual(data["version"], "0.1.0")


class AgentRunsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_agent_runs_empty(self):
        resp = self.client.get("/api/runs")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["runs"], [])

    def test_agent_runs_with_data(self):
        from agents.models import AgentRun

        AgentRun.objects.create(
            issue_url="https://github.com/owner/repo/issues/1",
            issue_number=1,
            repo_full_name="owner/repo",
            installation_id="123",
        )
        resp = self.client.get("/api/runs")
        data = resp.json()
        self.assertEqual(len(data["runs"]), 1)
        self.assertEqual(data["runs"][0]["issue"], "owner/repo#1")
        self.assertEqual(data["runs"][0]["status"], "queued")

    def test_agent_runs_limit(self):
        from agents.models import AgentRun

        for i in range(5):
            AgentRun.objects.create(
                issue_url=f"https://github.com/owner/repo/issues/{i}",
                issue_number=i,
                repo_full_name="owner/repo",
                installation_id="123",
            )
        resp = self.client.get("/api/runs?limit=3")
        data = resp.json()
        self.assertEqual(len(data["runs"]), 3)
