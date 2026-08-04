---
title: "SYNTARO Community Slack Workspace Guide"
status: "draft"
last-updated: "2026-07-28"
---

# SYNTARO Community — Slack Workspace Guide

## Overview

This document describes the setup, channel structure, moderation rules, bot integrations, and onboarding workflow for the SYNTARO community Slack workspace (`syntaro-community`). SYNTARO (Solving Tickets As A Service) is an AI-powered GitHub issue fix bot. This workspace exists to foster a collaborative community of developers using, contributing to, and extending SYNTARO.

---

## Channel Structure

### Core Channels

#### #welcome
- **Purpose**: Landing channel for new members. Contains the welcome message, getting-started links, and community guidelines.
- **Moderation**: Read-only for non-admin members. Only admins and automated bots may post. Violations result in a warning.
- **Pinned items**: Welcome message, Code of Conduct link, Getting Started guide, link to #introductions thread.

#### #general
- **Purpose**: Open discussion about SYNTARO — usage questions, best practices, general chatter related to automated issue fixing.
- **Moderation**: Stay on-topic (SYNTARO / AI-assisted development). No off-topic threads. Mods may move conversations to #random if off-topic.
- **Expected behavior**: Search before asking. Be concise. Use threads for replies longer than 3 messages.

#### #support
- **Purpose**: Technical support for SYNTARO users — installation issues, configuration help, troubleshooting failed fixes, API questions.
- **Moderation**: Every thread must be tagged with a priority label (`:bug:`, `:question:`, `:help:`). Expect founders/contributors to respond within SLA. Do not cross-post the same issue in multiple channels.
- **SLA**: 4 hours during business hours (first 30 days), 8 hours thereafter. See [launch-day-support-plan.md](./launch-day-support-plan.md).

#### #showcase
- **Purpose**: Share what you've built with SYNTARO — fixed repos, workflows, automations, integrations, success stories.
- **Moderation**: Must include a description of what was accomplished. No link-only posts. One showcase per thread. Self-promotion of commercial products is not allowed unless it directly relates to a SYNTARO integration.

#### #feedback
- **Purpose**: Feature requests, bug reports, product feedback. Every piece of feedback is read by the SYNTARO team.
- **Moderation**: Use the template pinned in the channel. One topic per thread. Search before posting to avoid duplicates. Constructive feedback only ("X doesn't work well because Y" rather than "X sucks").

#### #contributing
- **Purpose**: Coordination for open-source contributors — PR discussions, code reviews, contribution guidelines, onboarding new contributors.
- **Moderation**: Follow the [CONTRIBUTING.md](https://github.com/Aimino-Tech/syntaro/blob/main/CONTRIBUTING.md) guide. PRs must link to an open issue. No drive-by "I'll take this" without following up.

#### #changelog
- **Purpose**: Automated release announcements, changelog updates, breaking-change notices, deprecation warnings.
- **Moderation**: Read-only for non-admin members. Only CI/CD bots and maintainers may post. Each release gets its own thread for discussion.

#### #random
- **Purpose**: Off-topic conversation, water-cooler chat, memes, non-SYNTARO content.
- **Moderation**: No harassment, no spam, no NSFW content. Keep it friendly. Use threads for extended conversations.

---

## Welcome Message Draft

> **Welcome to the SYNTARO Community! 👋**
>
> SYNTARO (Solving Tickets As A Service) is an AI agent that automatically fixes GitHub issues — just tag `@syntaro` on any issue and it produces a pull request.
>
> **Getting Started**
> - 📖 Read the docs: https://docs.syntaro.ai
> - 🚀 Install: `npm install -g @aimino/syntaro` or visit our GitHub Marketplace listing
> - 🎯 Try it: Tag `@syntaro` on any open GitHub issue in a repo where SYNTARO is installed
> - 💻 Source code: https://github.com/Aimino-Tech/syntaro
>
> **Need Help?**
> - ❓ Ask in #support with a clear description of your issue
> - 🔍 Search #support and #general before asking — your question may already be answered
> - 📬 For urgent issues, email support@syntaro.ai
>
> **Want to Contribute?**
> - 🛠 Check #contributing for open issues and PR guidelines
> - 💡 Share ideas in #feedback
> - 🌟 Show us what you've built in #showcase
>
> **Community Rules**
> - Be respectful and inclusive
> - No spam, no self-promotion
> - Use the right channels
> - Search before asking
> - Full Code of Conduct: https://github.com/Aimino-Tech/syntaro/blob/main/CODE_OF_CONDUCT.md
>
> Introduce yourself in the #general channel! Tell us what you're building with SYNTARO.

---

## Slack Bot Integration Setup

### GitHub Issue Notifications

Configure a Slack app with the following:

1. **Slack App Name**: `SYNTARO GitHub Notifier`
2. **Scopes (Bot Token)**:
   - `chat:write`
   - `channels:read`
   - `channels:join`
   - `users:read`
3. **Event Subscriptions**:
   - Subscribe to GitHub webhook events via the SYNTARO API endpoint `/api/v1/slack/notifications`
   - Payload URL: `https://api.syntaro.ai/api/v1/slack/notifications`
4. **Channel**: Post to #changelog and optionally #general for major announcements

**GitHub Webhook Configuration**:
- Payload URL: `https://api.syntaro.ai/api/v1/github/webhook`
- Events: `Issues`, `Pull Requests`, `Releases`, `Discussions`
- Secret: Set via `SLACK_GITHUB_WEBHOOK_SECRET` environment variable

### Deploy Notifications

1. **CI/CD Pipeline Integration**: Configure your deployment pipeline (GitHub Actions, GitLab CI, etc.) to post to a Slack webhook on deploy events.
2. **Webhook URL**: `https://hooks.slack.com/services/TXXXXX/BXXXXX/XXXXX` (deployment channel)
3. **Channel**: #changelog
4. **Events**:
   - `deploy.started` — deployment begins
   - `deploy.completed` — deployment succeeded, new version live
   - `deploy.failed` — deployment rolled back or failed
5. **Format**: Use Slack's `mrkdwn` message format with attachments for status, version, and commit hash.

### Automated Welcome DM

1. **Slack App Name**: `SYNTARO Welcome Bot`
2. **Trigger**: `member_joined_channel` event on #welcome
3. **Action**: Send a direct message to the new member with the welcome message (see above).
4. **Scopes**: `chat:write`, `users:read`, `channels:read`
5. **Implementation**:

```typescript
// Example: Welcome bot handler (TypeScript)
import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.event("member_joined_channel", async ({ event, client }) => {
  if (event.channel === "C1234567890") {
    // #welcome channel ID
    await client.chat.postMessage({
      channel: event.user,
      text: `Welcome to SYNTARO Community! 🎉 We're glad you're here...`,
    });
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("Welcome bot running!");
})();
```

---

## Community Guidelines

### Core Principles

1. **Be Respectful** — Treat others with dignity and respect. Disagreement is fine; personal attacks are not.
2. **No Spam** — Do not post unsolicited links, advertisements, or repetitive messages.
3. **No Self-Promotion** — Do not promote your own products, services, or content unless it directly relates to a SYNTARO integration and is shared in #showcase or #feedback.
4. **Use the Right Channels** — Keep conversations in the appropriate channel. Off-topic posts will be moved by moderators.
5. **Search Before Asking** — Check existing threads, documentation, and pinned messages before posting a question.
6. **Be Constructive** — Criticism should be specific and actionable. "This doesn't work for X because Y" is helpful. "This sucks" is not.
7. **Protect Privacy** — Do not share private information (API keys, passwords, personal data) in public channels. Use DMs for sensitive information.
8. **Follow the Law** — Do not discuss or encourage illegal activities, including copyright infringement, unauthorized access, or fraud.

### Enforcement

Violations of these guidelines are handled according to the enforcement process in the [Code of Conduct](./code-of-conduct.md). First violations typically result in a warning; repeat violations may result in temporary or permanent bans.

---

## Spam Protection and Moderation

### Slack's Built-in Moderation

1. **Message Attachments**: Enable "Restrict file uploads" to approved file types only.
2. **Link Preview**: Disable link previews for known spam domains via workspace settings.
3. **Rate Limits**: Slack enforces rate limits per workspace. Configure:
   - Max 1 message per second per user (default)
   - Max 10 DMs per minute per user
4. **Two-Factor Authentication**: Require 2FA for all workspace members.

### Keyword Filters

Configure Slack's built-in message restriction rules (via Slack Admin > Workspace Settings > Moderation):

| Rule | Action | Channel |
|------|--------|---------|
| `(http|https)://(.*\\.)?(spamdomain\\.com|bit\\.ly/.*)` | Delete + warn user | All channels |
| `(buy now|click here|limited time|act now)` (commercial spam) | Delete + warn user | All channels except #random |
| `@everyone` or `@channel` | Delete + warn user | #support, #feedback, #showcase |
| Repeated links to the same domain (>3x/day) | Delete + temporary mute (1h) | All channels |
| Profanity / hate speech (custom list) | Delete + report to admins | All channels |

**Implementation**: Use Slack's Workflow Builder or a custom Slack app with the `moderation` API to enforce these rules.

### Moderator Actions

1. **Warning**: Send a DM to the user explaining the violation and linking to the guidelines. Log in #mod-log (private channel).
2. **Message Deletion**: Delete the violating message. Log the action in #mod-log with reason.
3. **Temporary Mute**: Use Slack's "Temporarily mute user" feature (1h, 24h, 7d) for repeat offenses.
4. **Temporary Ban**: Remove user from workspace. Log the reason and duration in #mod-log. Notify the user via email.
5. **Permanent Ban**: Remove user from workspace and block re-join. Used only for severe or repeated violations after warnings.

### Moderator Guidelines

- Actions should be proportional to the violation.
- Always warn before banning for first-time minor violations.
- Keep a private #mod-log channel for all moderation actions.
- Two mods should concur on any ban longer than 24 hours.
- Review moderation logs weekly.

---

## Onboarding Workflow

### Auto-Role Assignment

1. **New member joins** → `member_joined_channel` event fires on #welcome
2. **Role assignment**: All new members automatically receive the `@community-member` role
3. **Optional role opt-in**:
   - `@contributor` — Request via #contributing after submitting a PR
   - `@power-user` — Assigned by admins to active, helpful members (used for moderator recruitment)
   - `@moderator` — Assigned to trusted community members (see launch-day-support-plan.md)

### Welcome DM Sequence

| Time | Message | Purpose |
|------|---------|---------|
| T+0 | Welcome message (full version above) | Introduce SYNTARO |
| T+1h | "Have you tried SYNTARO yet? Here's a quick start..." | Encourage first use |
| T+24h | "Need help getting started? Check #support or our docs" | Support nudge |
| T+7d | "How's it going with SYNTARO? We'd love your feedback in #feedback" | Engagement check |

### Introduce Yourself Thread

In #general, a pinned thread titled **"Introduce Yourself!"** where new members can post:

> 👋 **Welcome! Introduce yourself here!**
>
> Share a little about yourself:
> - What's your name / handle?
> - What are you building?
> - How did you hear about SYNTARO?
> - What's one thing you hope SYNTARO can help you with?

This thread is monitored by the community team. New member intros are acknowledged with a reaction and a reply from the community team within 24 hours.

---

## Channels Quick Reference

| Channel | Purpose | Read-Only | Moderation Priority |
|---------|---------|-----------|---------------------|
| #welcome | Landing & onboarding | Yes (non-admins) | Low |
| #general | General discussion | No | Medium |
| #support | Technical support | No | High |
| #showcase | User success stories | No | Low |
| #feedback | Feature requests & bugs | No | Medium |
| #contributing | OSS contribution coordination | No | Medium |
| #changelog | Release announcements | Yes (non-admins) | Low |
| #random | Off-topic | No | Low |
| #mod-log | Moderation logging (private) | Yes (mods only) | — |
