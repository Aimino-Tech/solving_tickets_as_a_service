"""
STAS Celery Task Modules.

Each submodule corresponds to a Celery queue used in the agent pipeline:
  - triage: Issue classification
  - agent: OpenCode agent dispatch
  - sandbox: E2B sandbox management
  - verification: Test suite verification
  - pr_creation: GitHub PR creation
  - notifications: Slack/webhook notifications
"""
