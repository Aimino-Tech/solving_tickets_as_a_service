# Aimino Tech GmbH — Discord Overhaul Plan

## Phase 1: Server Foundation
1. Set server icon (use Aimino brand asset)
2. Enable Community mode (unlocks welcome screen, rules, announcements)
3. Set server description & invite splash

## Phase 2: Role Structure
| Role | Color | Permissions |
|------|-------|-------------|
| Admin | Red | Full admin |
| Moderator | Green | Kick/ban/manage messages/timeout |
| Core Contributor | Blue | Special dev channel access |
| Member | Default | @everyone base permissions |
| Bot | Grey | Bot-specific |

## Phase 3: Channel Restructure

### 📢 WELCOME & INFO
- `#welcome` — onboarding + rules (with membership screening)
- `#announcements` — release notes, product updates (announcement channel)
- `#roadmap` — public product direction

### 💬 COMMUNITY (keep existing)
- `#general` — main chat
- `#showcase` — user builds with OpenTalk2HTML
- `#feedback` — feature requests
- `#off-topic` — non-technical chat

### 🛠️ SUPPORT & DEV
- `#help` — user Q&A
- `#api-docs` — API discussions
- `#contributing` — contribution guide
- `#dev-log` — dev updates
- `#code-review` — PR discussion (new)

### 🤖 BOT COMMANDS (new)
- `#bot-spam` — bot command testing

### 🔊 VOICE
- General — voice chat
- Stage — community events (new)

## Phase 4: Content & Onboarding
- Draft welcome message (pinned)
- Community guidelines
- Membership screening questions
- Auto-role on accept rules

## Phase 5: Hermes Bot Integration
- Create Discord Application (Bot)
- Configure `gateway/platforms/discord.py`
- Set bot permissions & invite
- Test slash commands & messaging

## Phase 6: Launch Prep
- Review all permissions
- Test member onboarding flow
- Create invite link with splash
