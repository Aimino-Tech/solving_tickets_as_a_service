# Pipeline Status Comments

> Real-time pipeline progress posted to Linear (cloud) and GitHub issues (OSS).
> Last updated: 2026-06-25

## Overview

SYNTARO posts a **single evolving comment** per issue that tracks pipeline stage
transitions in real time. As each stage starts, completes, or fails, the
comment is updated in place — never creating a new comment. This keeps the
issue thread clean while giving the user full visibility into progress.

```
 Issue: Fix login validation (#42)
 ─────────────────────────────────────────
  Pipeline Progress — #42

  ✅ 📋 Triage — Bug confirmed
  ✅ 🔍 Research — Root cause found
  ⏳ 🤖 Agent — Writing fix...
  ~~🧪 Verify~~ — _pending_
  ~~🔬 Self-Audit~~ — _pending_
  ~~👁️ Review~~ — _pending_
  ~~🔄 PR~~ — _pending_
 ─────────────────────────────────────────
```

## Two delivery channels

| Deployment | Backend | Module | Config |
|-----------|---------|--------|--------|
| **Cloud** (SYNTARO hosted) | Linear API | `status_comments.py` | `SYNTARO_STATUS_COMMENTS_ENABLED` |
| **OSS** (self-hosted) | GitHub API | `oss_status.py` | `SYNTARO_OSS_STATUS_ENABLED` |

In the **cloud** deployment, status comments are posted to the Linear issue
that triggered the pipeline.  In **OSS** (self-hosted) mode, they are posted
as GitHub issue comments on the originating issue.

Both channels can run simultaneously.  When the pipeline detects it is
operating in OSS mode it calls `post_oss_comment` alongside the standard
`post_stage_comment`.

## Stage / emoji reference

| Stage | Emoji | Label | Meaning |
|-------|-------|-------|---------|
| `triage` | 📋 | Triage | Issue is validated, deduplicated, scoped |
| `research` | 🔍 | Research | Codebase is explored for root cause |
| `agent` | 🤖 | Agent | OpenCode agent is writing the fix |
| `verify` | 🧪 | Verify | Test suite is run against the fix |
| `self_audit` | 🔬 | Self-Audit | Quality gates run on the generated code |
| `review` | 👁️ | Review | Human review requested |
| `pr` | 🔄 | PR | Pull request is being created |
| `failed` | ❌ | Failed | Stage (or entire pipeline) failed |

## Coalescing

Completed-stage events are **coalesced** (batched) within a short time window
to avoid flooding the issue with rapid updates.  Start and failure events are
posted immediately.

| Parameter | Cloud (Linear) | OSS (GitHub) |
|-----------|---------------|--------------|
| Coalesce window | 5 s | 3 s |
| Max batch | Unlimited | 10 events |
| Module | `coalescer.StageCoalescer` | `oss_coalescer.OssStageCoalescer` |

The coalescer timer resets every time a new event is added.  Once the idle
window expires (or the max batch is reached for OSS), all buffered events
are flushed in a single update to the progressive comment.

## Cloud (Linear) — `status_comments.py`

```
workers/notifications/
├── __init__.py
├── status_comments.py     # Linear comment posting
├── coalescer.py           # StageCoalescer
├── progressive.py         # Collapsible HTML comment builder
└── ...
```

**Env vars:**

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_STATUS_COMMENTS_ENABLED` | `true` | Set to `false` to disable all Linear status comments |

**Signal-driven:** Importing `status_comments` connects Celery signal handlers
(`task_prerun`, `task_success`, `task_failure`) that automatically post
comments for known pipeline-stage tasks.

**Direct API:** `post_stage_comment(issue_id, stage, status, message)`

## OSS (GitHub) — `oss_status.py`

```
workers/notifications/
├── oss_status.py            # GitHub issue comment posting
├── oss_coalescer.py         # OssStageCoalescer
└── ...
```

**Env vars:**

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_OSS_STATUS_ENABLED` | `true` | Set to `false` to disable OSS status comments |
| `SYNTARO_OSS_STATUS_COALESCE_SECONDS` | `3` | Coalesce window for completed stages |
| `SYNTARO_OSS_STATUS_MAX_BATCH` | `10` | Max events before forced flush |
| `GITHUB_TOKEN` | — | Token with `issues:write` scope for posting comments |

**Direct API:** `post_oss_comment(repo, issue_id, stage, status, message)`

## Testing

```bash
# Run all status comment tests
python3 -m pytest workers/tests/test_status_comments.py -v
python3 -m pytest workers/tests/test_oss_status.py -v
python3 -m pytest workers/tests/test_progressive.py -v
```

## Adding a new stage

1. Add an entry to `STAGE_EMOJI` and `STAGE_LABELS` in both
   `status_comments.py` and `oss_status.py`.
2. Add the stage to `STAGE_ORDER` in `progressive.py`.
3. If the stage maps to a Celery task, add it to `TASK_STAGE_MAP` in
   `status_comments.py`.
4. Add tests for the new stage in `test_status_comments.py` and
   `test_oss_status.py`.
