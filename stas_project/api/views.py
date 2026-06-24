import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


@require_GET
def health(request):
    """Health check endpoint — mirrors Express /health."""
    return JsonResponse({
        "status": "ok",
        "service": "stas-django",
        "version": "0.1.0",
    })


@require_GET
def agent_runs(request):
    """List recent agent runs."""
    from agents.models import AgentRun

    limit = int(request.GET.get("limit", "20"))
    runs = AgentRun.objects.order_by("-created_at")[:limit]

    return JsonResponse({
        "runs": [
            {
                "id": str(r.id),
                "issue": f"{r.repo_full_name}#{r.issue_number}",
                "status": r.status,
                "pr_url": r.pr_url,
                "created_at": r.created_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in runs
        ]
    })
