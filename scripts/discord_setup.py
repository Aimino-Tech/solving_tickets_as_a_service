"""
Discord Server Setup Script — AIMino Tech GmbH
Creates categories, channels, roles, and permissions.

Usage: TOKEN=MTUxNDIyNDI2NTIyODk3NjE3OA.GcQw6c.E6Nr0nbtvllvuCWgLTEvzZIGiW3QNG0Ifvv9p0 \
       GUILD_ID=<server_id> \
       python3 scripts/discord_setup.py
"""

import os
import asyncio
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import discord
from discord import PermissionOverwrite, Permissions
from discord.utils import get

TOKEN = os.environ.get("TOKEN")
GUILD_ID = os.environ.get("GUILD_ID")

if not TOKEN:
    print("❌ TOKEN env var required")
    sys.exit(1)

STRUCTURE = {
    "📢 ANNOUNCEMENTS": {
        "position": 0,
        "channels": [
            {
                "name": "welcome",
                "type": "text",
                "topic": "Welcome to AIMino Tech GmbH! 👋 Read the rules, pick your roles, and say hello.",
                "position": 0,
                "slowmode": 0,
                "read_only": True,
            },
            {
                "name": "announcements",
                "type": "text",
                "topic": "Product updates, releases, and important news from AIMino.",
                "position": 1,
                "slowmode": 0,
                "read_only": True,
            },
            {
                "name": "roadmap",
                "type": "text",
                "topic": "What's coming next — preview upcoming features and vote on priorities.",
                "position": 2,
                "slowmode": 0,
                "read_only": True,
            },
        ],
    },
    "💬 COMMUNITY": {
        "position": 1,
        "channels": [
            {
                "name": "general",
                "type": "text",
                "topic": "General discussion about AIMino, AI, and everything in between.",
                "position": 0,
                "slowmode": 0,
            },
            {
                "name": "showcase",
                "type": "text",
                "topic": "Show off what you've built with AIMino! Projects, demos, experiments.",
                "position": 1,
                "slowmode": 0,
            },
            {
                "name": "feedback",
                "type": "text",
                "topic": "Feature requests, suggestions, and constructive feedback.",
                "position": 2,
                "slowmode": 5,
            },
            {
                "name": "off-topic",
                "type": "text",
                "topic": "Non-AIMino chat — memes, hobbies, random conversations.",
                "position": 3,
                "slowmode": 0,
            },
        ],
    },
    "🛠️ SUPPORT & DEV": {
        "position": 2,
        "channels": [
            {
                "name": "help",
                "type": "text",
                "topic": "Get help with AIMino products — ask questions, report issues.",
                "position": 0,
                "slowmode": 3,
            },
            {
                "name": "api-docs",
                "type": "text",
                "topic": "Technical discussion about AIMino APIs, SDKs, and integrations.",
                "position": 1,
                "slowmode": 0,
            },
            {
                "name": "contributing",
                "type": "text",
                "topic": "Open-source contributions — PRs, issues, dev coordination.",
                "position": 2,
                "slowmode": 0,
            },
            {
                "name": "dev-log",
                "type": "text",
                "topic": "Bot activity feed — automated changelog and deployment updates.",
                "position": 3,
                "slowmode": 0,
                "read_only": True,
            },
        ],
    },
}

ROLES = [
    {
        "name": "Admin",
        "color": 0xED4245,  # red
        "permissions": Permissions.all(),
        "mentionable": True,
        "position": 100,
    },
    {
        "name": "Moderator",
        "color": 0x5865F2,  # blurple
        "permissions": Permissions(
            kick_members=True,
            ban_members=True,
            manage_channels=True,
            manage_messages=True,
            mute_members=True,
            deafen_members=True,
            move_members=True,
            moderate_members=True,
        ),
        "mentionable": True,
        "position": 90,
    },
    {
        "name": "Beta Tester",
        "color": 0x9B59B6,  # purple
        "permissions": Permissions(),
        "mentionable": True,
        "position": 80,
    },
    {
        "name": "Contributor",
        "color": 0x57F287,  # green
        "permissions": Permissions(),
        "mentionable": True,
        "position": 70,
    },
    {
        "name": "Member",
        "color": 0xFEE75C,  # yellow
        "permissions": Permissions(
            read_messages=True,
            send_messages=True,
            connect=True,
            speak=True,
            add_reactions=True,
            embed_links=True,
            attach_files=True,
            read_message_history=True,
            use_external_emojis=True,
        ),
        "mentionable": False,
        "position": 60,
    },
]

CHANNEL_EMOJIS = {
    "welcome": "\uD83D\uDC4B",
    "announcements": "\uD83D\uDCE2",
    "roadmap": "\uD83D\uDEE4\uFE0F",
    "general": "\uD83D\uDCAC",
    "showcase": "\uD83C\uDF1F",
    "feedback": "\uD83D\uDCDD",
    "off-topic": "\uD83C\uDF0D",
    "help": "\uD83C\uDFD7\uFE0F",
    "api-docs": "\uD83D\uDEE0\uFE0F",
    "contributing": "\uD83E\uDEAA",
    "dev-log": "\u2699\uFE0F",
}


async def setup_guild(guild: discord.Guild):
    print(f"\n🔧 Setting up server: {guild.name} (ID: {guild.id})")

    # --- ROLES ---
    print("\n--- Roles ---")
    existing_roles = {r.name: r for r in guild.roles if not r.is_default()}
    created_roles = {}

    for role_def in ROLES:
        name = role_def["name"]
        if name in existing_roles:
            role = existing_roles[name]
            await role.edit(
                color=discord.Color(role_def["color"]),
                mentionable=role_def["mentionable"],
            )
            print(f"  ✅ Updated role: {name}")
        else:
            role = await guild.create_role(
                name=name,
                color=discord.Color(role_def["color"]),
                permissions=role_def["permissions"],
                mentionable=role_def["mentionable"],
            )
            print(f"  ✅ Created role: {name}")
        created_roles[name] = role

    # Re-order roles by position (lowest first in the API)
    sorted_roles = sorted(
        [r for _, r in created_roles.items()],
        key=lambda r: ROLES[[d["name"] for d in ROLES].index(r.name)]["position"],
        reverse=True,
    )
    # Include @everyone at bottom
    everyone = guild.default_role
    role_order = [everyone] + sorted_roles
    await guild.edit_role_positions(role_order)

    # --- CATEGORIES & CHANNELS ---
    print("\n--- Categories & Channels ---")
    existing_categories = {
        c.name: c for c in guild.categories
    }

    # Track all channels we create to set positions at the end
    all_channels = {}

    for cat_name, cat_data in STRUCTURE.items():
        if cat_name in existing_categories:
            category = existing_categories[cat_name]
            await category.edit(position=cat_data["position"])
            print(f"  📁 Updated category: {cat_name}")
        else:
            category = await guild.create_category(
                cat_name,
                position=cat_data["position"],
            )
            print(f"  📁 Created category: {cat_name}")

        # Channels in this category
        existing_channels = {c.name: c for c in category.channels}

        for ch_def in cat_data["channels"]:
            ch_name = ch_def["name"]

            # Build permission overwrites
            overwrites = {}
            # @everyone defaults
            everyone_perms = PermissionOverwrite()
            if ch_def.get("read_only"):
                everyone_perms.send_messages = False
                everyone_perms.add_reactions = False

            overwrites[everyone] = everyone_perms

            # Override for Admin role
            if "Admin" in created_roles:
                admin_overwrite = PermissionOverwrite()
                admin_overwrite.manage_channels = True
                admin_overwrite.manage_messages = True
                overwrites[created_roles["Admin"]] = admin_overwrite

            if ch_name in existing_channels:
                channel = existing_channels[ch_name]
                await channel.edit(
                    topic=ch_def.get("topic"),
                    slowmode_delay=ch_def.get("slowmode", 0),
                    position=ch_def["position"],
                    overwrites=overwrites,
                )
                print(f"    ✅ Updated channel: #{ch_name}")
            else:
                channel = await guild.create_text_channel(
                    ch_name,
                    category=category,
                    topic=ch_def.get("topic"),
                    slowmode_delay=ch_def.get("slowmode", 0),
                    position=ch_def["position"],
                    overwrites=overwrites,
                )
                print(f"    ✅ Created channel: #{ch_name}")

            all_channels[ch_name] = channel

    return created_roles, all_channels


async def send_welcome(guild, channels, roles):
    """Post the welcome message in #welcome."""
    welcome_ch = channels.get("welcome")
    if not welcome_ch:
        return

    member_role = roles.get("Member")
    admin_role = roles.get("Admin")

    content = f"""# Welcome to **AIMino Tech GmbH**! 🚀

We're building the next generation of AI-powered tools. Whether you're here for support, development, or just curious — you're in the right place.

## 📋 Quick Start

1. **Introduce yourself** in <#{channels.get('general', {}).id if 'general' in channels else ''}> — tell us what you're working on!
2. **Check announcements** in <#{channels.get('announcements', {}).id if 'announcements' in channels else ''}> for the latest updates
3. **Get help** in <#{channels.get('help', {}).id if 'help' in channels else ''}> if you run into issues
4. **Show off** your projects in <#{channels.get('showcase', {}).id if 'showcase' in channels else ''}>

## 🏷️ Roles

- **{member_role.mention if member_role else '@Member'}** — everyone gets this
- **@Beta Tester** — opt in to test pre-release features
- **@Contributor** — for open-source contributors
- **@Moderator** — community helpers

## 📜 Rules

1. Be respectful — no harassment, hate speech, or toxic behavior
2. Stay on topic in dedicated channels
3. No spam, self-promo, or unsolicited DMs
4. Follow the [AIMino Code of Conduct](https://aimino.de/code-of-conduct)

---

*Questions? Ping a {admin_role.mention if admin_role else 'mod'} or post in <#{channels.get('help', {}).id if 'help' in channels else ''}>*
"""

    try:
        await welcome_ch.send(content)
        print(f"  ✅ Welcome message posted in #welcome")
    except Exception as e:
        print(f"  ⚠️ Could not post welcome message: {e}")


async def main():
    intents = discord.Intents.default()

    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        print(f"🤖 Logged in as {client.user} (ID: {client.user.id})")

        # If GUILD_ID provided, use that guild; otherwise use first available
        if GUILD_ID:
            guild = client.get_guild(int(GUILD_ID))
            if not guild:
                print(f"❌ Guild ID {GUILD_ID} not found. Available guilds:")
                for g in client.guilds:
                    print(f"   - {g.name} (ID: {g.id})")
                await client.close()
                return
        else:
            if not client.guilds:
                print("❌ Bot is not in any server. Invite it first!")
                await client.close()
                return
            guild = client.guilds[0]
            print(f"📋 Using first available guild: {guild.name} ({guild.id})")

        roles, channels = await setup_guild(guild)

        print("\n--- Welcome Message ---")
        await send_welcome(guild, channels, roles)

        print(f"\n🎉 Server setup complete!")
        print(f"   Server: {guild.name}")
        print(f"   Categories: {len(STRUCTURE)}")
        print(f"   Channels: {sum(len(c['channels']) for c in STRUCTURE.values())}")
        print(f"   Roles: {len(ROLES)}")

        await client.close()

    await client.start(TOKEN, timeout=30)


if __name__ == "__main__":
    asyncio.run(main())
