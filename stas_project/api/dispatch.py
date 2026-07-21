import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from agents.models import AgentRun
from agents.tasks import run_issue_pipeline

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def dispatch(request):
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    issue_id = body.get("issue_id", "")
    repo = body.get("repo", "")
    tenant = body.get("tenant", "default")
    issue_number = body.get("issue_number")
    title = body.get("title", "")
    body_text = body.get("body", "")
    labels = body.get("labels", [])
    source = body.get("source", "github")
    installation_id = body.get("installation_id", 0)

    if not issue_id or not repo:
        return JsonResponse(
            {"error": "issue_id and repo are required"}, status=400
        )

    issue_url = f"https://github.com/{repo}/issues/{issue_number or 'unknown'}"

    try:
        run = AgentRun.objects.create(
            issue_url=issue_url,
            issue_number=int(issue_number) if issue_number else None,
            repo_full_name=repo,
            installation_id=str(installation_id),
            status=AgentRun.Status.QUEUED,
        )
        logger.info(
            "Created AgentRun %s for %s (tenant=%s, source=%s)",
            run.id,
            repo,
            tenant,
            source,
        )
    except Exception as e:
        logger.error("Failed to create AgentRun: %s", e)
        return JsonResponse({"error": f"Failed to create run: {e}"}, status=500)

    try:
        run_issue_pipeline.delay(
            issue_url=issue_url,
            issue_number=run.issue_number,
            repo_full_name=repo,
            repo_url=f"https://github.com/{repo}",
            installation_id=int(installation_id) if installation_id else 0,
        )
        logger.info("Enqueued pipeline for run %s", run.id)
    except Exception as e:
        logger.error("Failed to enqueue pipeline: %s", e)
        run.status = AgentRun.Status.FAILED
        run.error_message = str(e)
        run.save(update_fields=["status", "error_message"])

    return JsonResponse({
        "run_id": str(run.id),
        "status": run.status,
        "issue_url": issue_url,
        "tenant": tenant,
        "summary": f"Dispatched {issue_id} to OpenSymphony pipeline",
    })
