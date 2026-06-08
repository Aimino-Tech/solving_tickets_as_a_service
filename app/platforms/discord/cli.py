#!/usr/bin/env python3
from __future__ import annotations
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.db import get_repository
from app.common.ai_drafting import draft_content
from app.common.models import DraftRequest
from app.platforms.discord.bot import MCPMonitorBot


async def send_message(token: str, channel_id: str, content: str) -> None:
    bot = MCPMonitorBot()
    await bot.login(token)
    channel = await bot.fetch_channel(int(channel_id))
    await channel.send(content)
    await bot.close()


def cmd_run(args: argparse.Namespace) -> None:
    MCPMonitorBot.run_bot(token=args.token, auto_reply=args.auto_reply)


def cmd_send(args: argparse.Namespace) -> None:
    import asyncio
    token = args.token or settings.discord_bot_token
    if args.draft:
        draft = draft_content(DraftRequest(
            platform="discord",
            topic=args.message,
            engagement_type="reply",
        ))
        message = draft.content
        print(f"[Draft] {message}\n")
    else:
        message = args.message
    asyncio.run(send_message(token, args.channel, message))
    print(f"Message sent to channel {args.channel}")


def cmd_list(args: argparse.Namespace) -> None:
    repo = get_repository()
    records = repo.query(
        platform="discord",
        status=args.status,
        limit=args.limit,
    )
    for r in records:
        print(f"{r.id[:8]} | {r.engagement_type:20s} | {r.status:20s} | {r.created_at[:19]}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="discord-engage", description="Discord MCP monitor bot")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="Run the Discord bot (long-running)")
    p_run.add_argument("--token", help="Bot token (default: from .env)")
    p_run.add_argument("--auto-reply", action="store_true", default=None,
                       help="Enable auto-reply (default: from .env)")
    p_run.set_defaults(func=cmd_run)

    p_send = sub.add_parser("send", help="Send a message to a Discord channel")
    p_send.add_argument("channel", help="Channel ID")
    p_send.add_argument("message", help="Message text or topic (with --draft)")
    p_send.add_argument("--draft", action="store_true", help="AI-draft the content")
    p_send.add_argument("--token", help="Bot token (default: from .env)")
    p_send.set_defaults(func=cmd_send)

    p_list = sub.add_parser("list", help="List Discord engagements")
    p_list.add_argument("--status", default=None, help="Filter by status")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
