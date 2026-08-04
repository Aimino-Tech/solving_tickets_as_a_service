"""
Slack bot — bidirectional communication with SYNTARO pipeline.

Uses Bolt SDK with Socket Mode for real-time events without
exposing a public HTTP endpoint.

Events handled:
  - /syntaro fix — Submit a fix request
  - app_mention — @SYNTARO mentions
  - message.im — Direct messages
  - block_actions — Button clicks (acknowledge, cancel, retry)

Environment variables:
  SLACK_BOT_TOKEN      — xoxb- token for the Slack app
  SLACK_SIGNING_SECRET — Signing secret from Slack app settings
  SLACK_APP_TOKEN      — xapp- token for Socket Mode (required for Socket Mode)
  SLACK_SOCKET_MODE    — Set to "true" to use Socket Mode (default: "true")
"""

from __future__ import annotations

import logging
import os
from typing import Any

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from workers.slack.handlers import (
    handle_acknowledge,
    handle_cancel,
    handle_retry,
    handle_slash_syntaro_fix,
    parse_fix_command,
)
from workers.slack.publisher import (
    SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET,
    get_client,
    post_message,
    send_pipeline_completed,
    send_pipeline_progress,
)

logger = logging.getLogger(__name__)


def create_app() -> App | None:
    if not SLACK_BOT_TOKEN or not SLACK_SIGNING_SECRET:
        logger.warning("SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET not set — Slack bot disabled")
        return None

    app = App(
        token=SLACK_BOT_TOKEN,
        signing_secret=SLACK_SIGNING_SECRET,
    )

    _register_handlers(app)
    return app


def _register_handlers(app: App) -> None:
    @app.command("/syntaro")
    def syntaro_command(ack, body, respond, say):
        ack()
        text = body.get("text", "")
        user_id = body.get("user_id", "")
        user_name = body.get("user_name", "unknown")
        channel_id = body.get("channel_id", "")
        trigger_id = body.get("trigger_id", "")

        parsed = parse_fix_command(text)
        description = parsed.get("description", text)

        handle_slash_syntaro_fix(user_id, user_name, channel_id, description, trigger_id)

        issue_title = f"Fix request from Slack: {description[:80]}"
        issue_body = f"Requested by {user_name} in <#{channel_id}>\n\n{description}"

        run_id = _trigger_fix_pipeline(issue_title, issue_body)
        say(text=f"🛠️ Fix requested — tracking as `{run_id}`", thread_ts=body.get("ts"))

    @app.event("app_mention")
    def handle_mention(event, say):
        text = event.get("text", "")
        channel = event.get("channel", "")
        ts = event.get("ts", "")

        if "fix" in text.lower():
            parsed = parse_fix_command(text)
            description = parsed.get("description", text)
            say(
                thread_ts=ts,
                text=f"🤖 Received fix request. Investigating...",
            )
            _trigger_fix_pipeline(
                f"Mention fix: {description[:80]}",
                f"Mentioned by <@{event.get('user', '')}> in <#{channel}>\n\n{description}",
            )

    @app.event("message")
    def handle_dm(event, say):
        channel_type = event.get("channel_type", "")
        if channel_type != "im":
            return

        text = event.get("text", "")
        ts = event.get("ts", "")
        channel = event.get("channel", "")

        if not text:
            return

        if text.lower().startswith("fix"):
            description = text[3:].strip()
            say(
                thread_ts=ts,
                text=f"🤖 Processing your fix request...",
            )
            _trigger_fix_pipeline(
                f"DM fix: {description[:80]}",
                f"Requested via DM\n\n{description}",
            )

    @app.action("acknowledge_fix")
    def handle_acknowledge_action(ack, body):
        ack()
        action = body["actions"][0]
        issue_id = action.get("value", "")
        channel = body.get("channel", {}).get("id", "")
        thread_ts = body.get("message", {}).get("ts", "")
        handle_acknowledge(issue_id, channel, thread_ts)

    @app.action("cancel_fix")
    def handle_cancel_action(ack, body):
        ack()
        action = body["actions"][0]
        run_id = action.get("value", "")
        channel = body.get("channel", {}).get("id", "")
        thread_ts = body.get("message", {}).get("ts", "")
        handle_cancel(run_id, channel, thread_ts)

    @app.action("retry_fix")
    def handle_retry_action(ack, body):
        ack()
        action = body["actions"][0]
        run_id = action.get("value", "")
        channel = body.get("channel", {}).get("id", "")
        thread_ts = body.get("message", {}).get("ts", "")
        handle_retry(run_id, channel, thread_ts)


def _trigger_fix_pipeline(issue_title: str, issue_body: str) -> str:
    from workers.pipeline_client import get_client

    pipeline = get_client()
    result = pipeline.submit_fix(
        owner="slack",
        repo="slack-request",
        issue_number=0,
        issue_url="",
        pipeline_name="syntaro:fix",
    )
    return result.get("run_id", "unknown")


_app: App | None = None


def get_slack_app() -> App | None:
    global _app
    if _app is None:
        _app = create_app()
    return _app


def start_slack_bot() -> None:
    app = get_slack_app()
    if app is None:
        logger.warning("Slack bot not started — missing credentials")
        return

    use_socket_mode = os.getenv("SLACK_SOCKET_MODE", "true").lower() == "true"
    app_token = os.getenv("SLACK_APP_TOKEN", "")

    if use_socket_mode and app_token:
        logger.info("Starting Slack bot in Socket Mode")
        handler = SocketModeHandler(app, app_token)
        handler.start()
    else:
        logger.info("Starting Slack bot in HTTP mode on port %s",
                     os.getenv("SLACK_PORT", "3000"))
        app.start(port=int(os.getenv("SLACK_PORT", "3000")))
