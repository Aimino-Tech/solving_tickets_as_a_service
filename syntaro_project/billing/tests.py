"""Tests for billing app — Subscription, UsageRecord, CreditBalance models."""
from django.test import TestCase

from agents.models import AgentRun

from .models import CreditBalance, Subscription, UsageRecord


class SubscriptionModelTest(TestCase):
    def test_create_subscription(self):
        sub = Subscription.objects.create(
            plan=Subscription.Plan.FREE,
            stripe_customer_id="cus_123",
            github_installation_id="inst_456",
        )
        self.assertTrue(sub.active)
        self.assertEqual(str(sub), "free (inst_456)")

    def test_subscription_default_plan(self):
        sub = Subscription.objects.create(stripe_customer_id="cus_789")
        self.assertEqual(sub.plan, Subscription.Plan.FREE)

    def test_subscription_upgrade(self):
        sub = Subscription.objects.create(
            plan=Subscription.Plan.FREE,
            stripe_customer_id="cus_upgrade",
        )
        sub.plan = Subscription.Plan.PRO
        sub.stripe_subscription_id = "sub_pro_123"
        sub.save()
        sub.refresh_from_db()
        self.assertEqual(sub.plan, Subscription.Plan.PRO)
        self.assertEqual(sub.stripe_subscription_id, "sub_pro_123")


class UsageRecordModelTest(TestCase):
    def setUp(self):
        self.sub = Subscription.objects.create(
            plan=Subscription.Plan.STARTER,
            stripe_customer_id="cus_usage",
        )
        self.run = AgentRun.objects.create(
            issue_url="https://github.com/owner/repo/issues/1",
            issue_number=1,
            repo_full_name="owner/repo",
            installation_id="inst_usage",
        )

    def test_create_usage_record(self):
        record = UsageRecord.objects.create(
            subscription=self.sub,
            agent_run=self.run,
            credits_used=5,
        )
        self.assertEqual(record.credits_used, 5)
        self.assertEqual(record.subscription, self.sub)
        self.assertEqual(record.agent_run, self.run)
        self.assertIn("5 credits", str(record))

    def test_usage_record_default_credit(self):
        record = UsageRecord.objects.create(
            subscription=self.sub,
        )
        self.assertEqual(record.credits_used, 1)
        self.assertIsNone(record.agent_run)


class CreditBalanceModelTest(TestCase):
    def setUp(self):
        self.sub = Subscription.objects.create(
            plan=Subscription.Plan.PRO,
            stripe_customer_id="cus_credit",
        )

    def test_create_credit_balance(self):
        balance = CreditBalance.objects.create(
            subscription=self.sub,
            balance=100,
        )
        self.assertEqual(balance.balance, 100)
        self.assertEqual(str(balance), "pro (cus_credit) — 100 credits")

    def test_credit_balance_default_zero(self):
        balance = CreditBalance.objects.create(subscription=self.sub)
        self.assertEqual(balance.balance, 0)

    def test_credit_balance_deduct(self):
        balance = CreditBalance.objects.create(subscription=self.sub, balance=50)
        balance.balance -= 10
        balance.save()
        balance.refresh_from_db()
        self.assertEqual(balance.balance, 40)
