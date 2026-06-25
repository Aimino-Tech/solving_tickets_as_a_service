from django.db import models


class AgentRun(models.Model):
    """Tracks an agent pipeline run for a single issue."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        TRIAGE = "triage", "Triage"
        DISPATCH = "dispatch", "Dispatch"
        SANDBOX = "sandbox", "Sandbox"
        VERIFICATION = "verification", "Verification"
        PR_CREATION = "pr_creation", "PR Creation"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    issue_url = models.URLField(max_length=500)
    issue_number = models.IntegerField(null=True, blank=True)
    repo_full_name = models.CharField(max_length=255)
    repo_url = models.URLField(max_length=500, blank=True)
    installation_id = models.CharField(max_length=100, blank=True)
    pr_url = models.URLField(max_length=500, null=True, blank=True)
    pr_number = models.IntegerField(null=True, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED, db_index=True)
    triage_result = models.JSONField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    webhook_event = models.ForeignKey(
        "webhooks.WebhookEvent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_runs",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["repo_full_name", "issue_number"]),
        ]

    def __str__(self):
        return f"{self.repo_full_name}#{self.issue_number} ({self.status})"
