import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Optional

import httpx

TELEGRAM_API_BASE = "https://api.telegram.org/bot"
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
API_BASE = f"{TELEGRAM_API_BASE}{BOT_TOKEN}"

INDIAN_DEV_GROUPS = {
    "foss_united": "@fossunited",
    "python_devs_india": "@pythondevelopersindia",
    "kerala_devs": "@keraladevs",
    "fp_india": "@fpindia",
}


def _client() -> httpx.Client:
    return httpx.Client(timeout=30)


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        print(f"[WARN] Engag. log failed: {e}", file=sys.stderr)


def send_message(chat_id: str, text: str, parse_mode: str = "Markdown",
                 disable_web_page_preview: bool = False) -> dict:
    with _client() as client:
        resp = client.post(f"{API_BASE}/sendMessage", json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": disable_web_page_preview,
        })
        if resp.status_code == 429:
            retry_after = resp.json().get("parameters", {}).get("retry_after", 5)
            time.sleep(retry_after)
            resp = client.post(f"{API_BASE}/sendMessage", json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": disable_web_page_preview,
            })
        resp.raise_for_status()
        result = resp.json()
        _log_engagement("telegram", "send_message", "success",
                        {"chat_id": chat_id, "message_id": result.get("result", {}).get("message_id")})
        return result


def get_updates(offset: int = None, timeout: int = 30) -> list[dict]:
    params = {"timeout": timeout}
    if offset:
        params["offset"] = offset
    with _client() as client:
        resp = client.get(f"{API_BASE}/getUpdates", params=params)
        resp.raise_for_status()
        return resp.json().get("result", [])


def set_webhook(url: str = None, drop_pending: bool = False) -> dict:
    if url:
        with _client() as client:
            resp = client.post(f"{API_BASE}/setWebhook", json={"url": url, "drop_pending_updates": drop_pending})
            resp.raise_for_status()
            return resp.json()
    else:
        with _client() as client:
            resp = client.post(f"{API_BASE}/deleteWebhook", json={"drop_pending_updates": drop_pending})
            resp.raise_for_status()
            return resp.json()


def get_group_member_count(chat_id: str) -> int:
    with _client() as client:
        resp = client.get(f"{API_BASE}/getChatMemberCount", params={"chat_id": chat_id})
        resp.raise_for_status()
        return resp.json().get("result", 0)


def is_bot_in_group(chat_id: str) -> bool:
    try:
        with _client() as client:
            resp = client.get(f"{API_BASE}/getChat", params={"chat_id": chat_id})
            return resp.status_code == 200
    except Exception:
        return False


def leave_group(chat_id: str) -> bool:
    try:
        with _client() as client:
            resp = client.post(f"{API_BASE}/leaveChat", json={"chat_id": chat_id})
            return resp.status_code == 200
    except Exception:
        return False


def filter_keyword_messages(updates: list[dict], keywords: list[str]) -> list[dict]:
    matched = []
    for update in updates:
        msg = update.get("message", {}) or update.get("channel_post", {})
        text = msg.get("text", "") or msg.get("caption", "") or ""
        text_lower = text.lower()
        if any(kw.lower() in text_lower for kw in keywords):
            matched.append({
                "update_id": update.get("update_id"),
                "chat_id": str(msg.get("chat", {}).get("id", "")),
                "chat_title": msg.get("chat", {}).get("title", ""),
                "text": text,
                "from_user": msg.get("from", {}).get("username", ""),
                "date": msg.get("date", 0),
                "matched_keywords": [kw for kw in keywords if kw.lower() in text_lower],
            })
    return matched


def join_group(invite_link: str) -> bool:
    try:
        with _client() as client:
            resp = client.post(f"{API_BASE}/joinChatByInviteLink", json={"invite_link": invite_link})
            return resp.status_code == 200
    except Exception:
        return False


def reply_to_message(chat_id: str, message_id: int, text: str, parse_mode: str = "Markdown") -> dict:
    with _client() as client:
        resp = client.post(f"{API_BASE}/sendMessage", json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "reply_to_message_id": message_id,
        })
        resp.raise_for_status()
        result = resp.json()
        _log_engagement("telegram", "reply_to_message", "success",
                        {"chat_id": chat_id, "reply_to": message_id})
        return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Telegram India bot for developer engagement")
    sub = parser.add_subparsers(dest="command", required=True)

    p_send = sub.add_parser("send", help="Send message to a group")
    p_send.add_argument("--chat-id", required=True)
    p_send.add_argument("--text", required=True)
    p_send.add_argument("--no-preview", action="store_true", dest="no_preview")

    p_list_groups = sub.add_parser("list-groups", help="List configured Indian dev groups")

    p_check = sub.add_parser("check-group", help="Check if bot is in a group")
    p_check.add_argument("--chat-id", required=True)

    p_poll = sub.add_parser("poll", help="Poll for new messages (long polling)")
    p_poll.add_argument("--offset", type=int)
    p_poll.add_argument("--timeout", type=int, default=30)
    p_poll.add_argument("--keywords", nargs="*", default=["mcp", "opensource", "openclaw"])

    p_join = sub.add_parser("join", help="Join a group via invite link")
    p_join.add_argument("--invite-link", required=True)

    p_reply = sub.add_parser("reply", help="Reply to a message")
    p_reply.add_argument("--chat-id", required=True)
    p_reply.add_argument("--message-id", type=int, required=True)
    p_reply.add_argument("--text", required=True)

    p_member_count = sub.add_parser("member-count", help="Get group member count")
    p_member_count.add_argument("--chat-id", required=True)

    args = parser.parse_args()

    if args.command == "send":
        result = send_message(args.chat_id, args.text, disable_web_page_preview=args.no_preview)
        print(json.dumps(result, indent=2))
    elif args.command == "list-groups":
        for name, chat_id in INDIAN_DEV_GROUPS.items():
            in_group = is_bot_in_group(chat_id)
            members = get_group_member_count(chat_id) if in_group else 0
            print(f"{name}: {chat_id} — {'joined' if in_group else 'not joined'} ({members} members)")
    elif args.command == "check-group":
        in_group = is_bot_in_group(args.chat_id)
        members = get_group_member_count(args.chat_id) if in_group else 0
        print(json.dumps({"chat_id": args.chat_id, "joined": in_group, "members": members}))
    elif args.command == "poll":
        updates = get_updates(offset=args.offset, timeout=args.timeout)
        matched = filter_keyword_messages(updates, keywords=args.keywords)
        print(json.dumps({"total_updates": len(updates), "matched": matched}, indent=2))
    elif args.command == "join":
        ok = join_group(args.invite_link)
        print(json.dumps({"joined": ok}))
    elif args.command == "reply":
        result = reply_to_message(args.chat_id, args.message_id, args.text)
        print(json.dumps(result, indent=2))
    elif args.command == "member-count":
        count = get_group_member_count(args.chat_id)
        print(json.dumps({"chat_id": args.chat_id, "members": count}))
