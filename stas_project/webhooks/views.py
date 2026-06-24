import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.http import HttpResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import WebhookEvent

logger = logging.getLogger(__name__)


def verify_github_signature(payload_body: bytes, signature_header: str) -> bool:
    """Verify GitHub webhook HMAC-SHA256 signature."""
    if not settings.GITHUB_WEBHOOK_SECRET:
        logger.warning("GITHUB_WEBHOOK_SECRET not set — skipping signature verification")
        return True
    secret = settings.GITHUB_WEBHOOK_SECRET.encode()
    expected = "sha256=" + hmac.new(secret, payload_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


@csrf_exempt
@require_POST
def github_webhook(request):
    """Handle incoming GitHub webhook events."""
    # Verify signature
    signature = request.META.get("HTTP_X_HUB_SIGNATURE_256", "")
    if not verify_github_signature(request.body, signature):
        logger.warning("GitHub webhook signature verification failed")
        return HttpResponseBadRequest("Signature verification failed")

    event_type = request.META.get("HTTP_X_GITHUB_EVENT", "unknown")

    # Parse payload
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    delivery_id = request.META.get("HTTP_X_GITHUB_DELIVERY", "")

    # Log event
    event = WebhookEvent.objects.create(
        source=WebhookEvent.Source.GITHUB,
        event_type=event_type,
        delivery_id=delivery_id,
        payload=payload,
    )

    # Check if this is a labelled issue we care about
    action = payload.get("action", "")
    if event_type == "issues" and action == "labeled":
        _handle_issue_labeled(payload, event)

    logger.info("GitHub webhook received: %s (delivery=%s)", event_type, delivery_id)
    return HttpResponse("OK")


def _handle_issue_labeled(payload: dict, event: WebhookEvent):
    """Dispatch a labeled issue to the agent pipeline."""
    from agents.tasks import run_issue_pipeline

    issue = payload.get("issue", {})
    label_name = payload.get("label", {}).get("name", "")
    repo = payload.get("repository", {})
    action = payload.get("action", "")

    # Check if label matches STAS trigger
    if label_name != settings.STAS_LABEL:
        return

    logger.info(
        "Issue #%d labeled with %s in %s/%s — dispatching agent pipeline",
        issue.get("number"),
        label_name,
        repo.get("owner", {}).get("login", ""),
        repo.get("name", ""),
    )

    event.status = WebhookEvent.Status.PROCESSING
    event.save(update_fields=["status"])

    # Enqueue Celery task
    run_issue_pipeline.delay(
        issue_url=issue.get("html_url", ""),
        issue_number=issue.get("number"),
        repo_full_name=f"{repo.get('owner', {}).get('login', '')}/{repo.get('name', '')}",
        repo_url=repo.get("clone_url", ""),
        installation_id=str(payload.get("installation", {}).get("id", "")),
        event_id=str(event.id),
    )


@csrf_exempt
@require_POST
def gitlab_webhook(request):
    """Handle incoming GitLab webhook events."""
    event_type = request.META.get("HTTP_X_GITLAB_EVENT", "unknown")
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    WebhookEvent.objects.create(
        source=WebhookEvent.Source.GITLAB,
        event_type=event_type,
        payload=payload,
    )
    logger.info("GitLab webhook received: %s", event_type)
    return HttpResponse("OK")


@csrf_exempt
@require_POST
def bitbucket_webhook(request):
    """Handle incoming Bitbucket webhook events."""
    event_type = request.META.get("HTTP_X_EVENT_KEY", "unknown")
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    WebhookEvent.objects.create(
        source=WebhookEvent.Source.BITBUCKET,
        event_type=event_type,
        payload=payload,
    )
    logger.info("Bitbucket webhook received: %s", event_type)
    return HttpResponse("OK")


@csrf_exempt
@require_POST
def linear_webhook(request):
    """Handle incoming Linear webhook events."""
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    event_type = payload.get("type", "unknown")
    WebhookEvent.objects.create(
        source=WebhookEvent.Source.LINEAR,
        event_type=event_type,
        payload=payload,
    )
    logger.info("Linear webhook received: %s", event_type)
    return HttpResponse("OK")


@csrf_exempt
@require_POST
def jira_webhook(request):
    """Handle incoming Jira webhook events."""
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    event_type = payload.get("webhookEvent", "unknown")
    WebhookEvent.objects.create(
        source=WebhookEvent.Source.JIRA,
        event_type=event_type,
        payload=payload,
    )
    logger.info("Jira webhook received: %s", event_type)
    return HttpResponse("OK")


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Handle incoming Stripe webhook events."""
    import stripe  # noqa: E402

    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

    if settings.STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.warning("Stripe webhook signature verification failed: %s", e)
            return HttpResponseBadRequest("Signature verification failed")
    else:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            return HttpResponseBadRequest("Invalid JSON payload")

    event_type = event.get("type", "unknown")
    WebhookEvent.objects.create(
        source=WebhookEvent.Source.STRIPE,
        event_type=event_type,
        payload=event,
    )
    logger.info("Stripe webhook received: %s", event_type)

    # Handle credit purchase
    if event_type in ("checkout.session.completed", "invoice.paid"):
        from billing.tasks import handle_stripe_payment
        handle_stripe_payment.delay(event_id=str(event.get("id", "")))

    return HttpResponse("OK")


@csrf_exempt
@require_POST
def slack_webhook(request):
    """Handle incoming Slack events."""
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload")

    # URL verification handshake
    if payload.get("type") == "url_verification":
        return HttpResponse(payload.get("challenge", ""), content_type="text/plain")

    event_type = payload.get("event", {}).get("type", "unknown")
    WebhookEvent.objects.create(
        source=WebhookEvent.Source.SLACK,
        event_type=event_type,
        payload=payload,
    )
    logger.info("Slack event received: %s", event_type)
    return HttpResponse("OK")
