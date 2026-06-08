from __future__ import annotations
import asyncio
import random
import discord
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.models import EngagementRecord
from app.common.db import get_repository
from app.common.rate_limiter import discord_limiter, RateLimitExceeded


class MCPMonitorBot(discord.Client):
    def __init__(self, auto_reply: bool | None = None, **kwargs):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents, **kwargs)
        self.auto_reply = auto_reply if auto_reply is not None else settings.discord_auto_reply_enabled
        self.target_guild_id = settings.discord_target_guild_id
        self.target_channel_id = settings.discord_mcp_channel_id

    async def on_ready(self):
        repo = get_repository()
        record = EngagementRecord(
            platform="discord",
            engagement_type="reply",
            content="Bot started",
            status="sent",
            metadata={"event": "on_ready", "user": str(self.user)},
        )
        repo.log_engagement(record)
        print(f"{self.user} is live and monitoring MCP mentions")

    async def on_message(self, message: discord.Message):
        if message.author == self.user:
            return

        if not self._is_mcp_related(message):
            return

        repo = get_repository()
        record = EngagementRecord(
            platform="discord",
            engagement_type="reply",
            content=message.content,
            target=str(message.channel.id),
            status="detected",
            metadata={
                "author": str(message.author),
                "channel": str(message.channel),
                "guild": str(message.guild) if message.guild else None,
                "message_id": str(message.id),
            },
        )
        repo.log_engagement(record)

        if not self.auto_reply:
            repo.update_status(record.id, "pending_approval")
            return

        try:
            limiter = discord_limiter()
            limiter.check()
        except RateLimitExceeded:
            repo.update_status(record.id, "rate_limited")
            return

        reply = self._make_reply()
        try:
            await message.reply(reply, mention_author=False)
            repo.update_status(record.id, "sent")
            record.mark_sent()
        except discord.Forbidden:
            repo.update_status(record.id, "failed", error="Missing permissions to reply")
        except discord.HTTPException as e:
            if e.status == 429:
                retry_after = float(e.response.headers.get("Retry-After", 60))
                wait = discord_limiter().handle_429(retry_after)
                repo.update_status(record.id, "rate_limited", error=f"429 retry_after={retry_after}")
                await asyncio.sleep(wait)
            else:
                repo.update_status(record.id, "failed", error=str(e))

    @staticmethod
    def _is_mcp_related(message: discord.Message) -> bool:
        content_lower = message.content.lower()
        mcp_keywords = ["mcp", "model context protocol", "ai tool", "openclaw"]
        if self_mention := message.guild and message.guild.me:
            if self_mention in message.mentions:
                return True
        return any(kw in content_lower for kw in mcp_keywords)

    @staticmethod
    def _make_reply() -> str:
        replies = [
            "Have you checked out open-source MCP tools? They make integrating AI with data sources really straightforward.",
            "MCP is a game-changer for AI tooling. Check out the OpenClaw project on GitHub for some practical implementations.",
            "If you're into MCP, you might find the OpenClaw MCP servers useful — they handle DuckDB, file systems, and browser automation.",
            "MCP tools are getting really practical. The open-source ones from OpenClaw are worth a look.",
            "For MCP, I'd recommend starting with the OpenClaw MCP servers — great examples of the protocol in action.",
        ]
        return random.choice(replies)


def run_bot(token: str | None = None, auto_reply: bool | None = None) -> None:
    bot = MCPMonitorBot(auto_reply=auto_reply)
    bot.run(token or settings.discord_bot_token)
