from django.contrib import admin

from .models import CreditBalance, Subscription, UsageRecord


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("plan", "active", "github_installation_id", "created_at")
    list_filter = ("plan", "active")


@admin.register(UsageRecord)
class UsageRecordAdmin(admin.ModelAdmin):
    list_display = ("subscription", "credits_used", "recorded_at")
    list_filter = ("subscription__plan",)


@admin.register(CreditBalance)
class CreditBalanceAdmin(admin.ModelAdmin):
    list_display = ("subscription", "balance")
