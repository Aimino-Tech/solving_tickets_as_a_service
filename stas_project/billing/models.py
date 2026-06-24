from django.db import models


class Subscription(models.Model):
    """Tracks a user/organization subscription plan."""

    class Plan(models.TextChoices):
        FREE = "free", "Free"
        STARTER = "starter", "Starter"
        PRO = "pro", "Pro"
        ENTERPRISE = "enterprise", "Enterprise"

    plan = models.CharField(max_length=20, choices=Plan.choices, default=Plan.FREE)
    stripe_subscription_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    stripe_customer_id = models.CharField(max_length=255, blank=True)
    github_installation_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.plan} ({self.github_installation_id or self.stripe_customer_id})"


class UsageRecord(models.Model):
    """Metered usage record for billing."""

    subscription = models.ForeignKey(
        Subscription, on_delete=models.CASCADE, related_name="usage_records"
    )
    agent_run = models.OneToOneField(
        "agents.AgentRun", on_delete=models.SET_NULL, null=True, blank=True
    )
    credits_used = models.PositiveIntegerField(default=1)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]

    def __str__(self):
        return f"{self.subscription} — {self.credits_used} credits"


class CreditBalance(models.Model):
    """Pre-paid credit balance for a subscription."""

    subscription = models.OneToOneField(
        Subscription, on_delete=models.CASCADE, related_name="credit_balance"
    )
    balance = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.subscription} — {self.balance} credits"
