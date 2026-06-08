import pytest
from unittest.mock import MagicMock, AsyncMock, patch, PropertyMock
from app.platforms.discord.bot import MCPMonitorBot
from app.common.db import get_repository


@pytest.fixture
def mock_message():
    msg = MagicMock()
    msg.author = MagicMock()
    msg.author.id = 12345
    msg.content = "Has anyone tried MCP tools for data engineering?"
    msg.channel = MagicMock()
    msg.channel.id = "123"
    msg.channel.send = AsyncMock()
    msg.reply = AsyncMock()
    msg.guild = MagicMock()
    msg.guild.me = MagicMock()
    msg.guild.me.id = 99999
    return msg


@pytest.fixture
def bot():
    b = MCPMonitorBot()
    with patch.object(type(b), 'user', new_callable=PropertyMock) as mock_user:
        mock_user.return_value = MagicMock()
        mock_user.return_value.id = 99999
        yield b


def test_is_mcp_related_true(bot, mock_message):
    assert bot._is_mcp_related(mock_message) is True


def test_is_mcp_related_false(bot, mock_message):
    mock_message.content = "What's the weather like today?"
    assert bot._is_mcp_related(mock_message) is False


def test_is_mcp_related_keywords(bot):
    for keyword in ["mcp", "MCP", "Model Context Protocol", "openclaw"]:
        msg = MagicMock()
        msg.content = keyword
        msg.author = MagicMock()
        msg.author.id = 12345
        msg.guild = MagicMock()
        msg.guild.me = MagicMock()
        msg.guild.me.id = 99999
        assert bot._is_mcp_related(msg), f"Should match: {keyword}"


def test_make_reply():
    bot = MCPMonitorBot()
    reply = bot._make_reply()
    assert len(reply) > 20
    assert len(reply) < 500


@pytest.mark.asyncio
async def test_on_message_ignores_self(bot, mock_message):
    mock_message.author.id = 99999
    await bot.on_message(mock_message)
    mock_message.reply.assert_not_called()


@pytest.mark.asyncio
async def test_on_message_logs_engagement(bot, mock_message):
    bot.auto_reply = False
    repo = get_repository(":memory:")
    await bot.on_message(mock_message)
    records = repo.query(platform="discord")
    assert len(records) >= 1
    assert records[0].status == "pending_approval"


@pytest.mark.asyncio
async def test_on_message_auto_reply(bot, mock_message):
    bot.auto_reply = True
    mock_message.reply = AsyncMock()
    with patch("common.rate_limiter.PlatformRateLimiter.check", return_value=None):
        await bot.on_message(mock_message)
        mock_message.reply.assert_called_once()
