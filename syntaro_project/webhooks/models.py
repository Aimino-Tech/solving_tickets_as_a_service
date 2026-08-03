from django.db import models


class WebhookEvent(models.Model):
    """Record of an incoming webhook event from any supported platform."""

    class Source(models.TextChoices):
        GITHUB = "github", "GitHub"
        GITLAB = "gitlab", "GitLab"
        BITBUCKET = "bitbucket", "Bitbucket"
        LINEAR = "linear", "Linear"
        JIRA = "jira", "Jira"
        STRIPE = "stripe", "Stripe"
        SLACK = "slack", "Slack"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    source = models.CharField(max_length=20, choices=Source.choices, db_index=True)
    event_type = models.CharField(max_length=100, db_index=True)
    delivery_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    payload = models.JSONField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    retry_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["source", "status"]),
            models.Index(fields=["status", "next_retry_at"]),
        ]

    def __str__(self):
        return f"[{self.source}] {self.event_type} ({self.status})"
