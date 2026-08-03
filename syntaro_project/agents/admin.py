from django.contrib import admin

from .models import AgentRun


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = ("repo_full_name", "issue_number", "status", "created_at", "completed_at")
    list_filter = ("status", "repo_full_name")
    search_fields = ("repo_full_name", "issue_url", "pr_url")
    readonly_fields = ("created_at", "updated_at", "completed_at")
