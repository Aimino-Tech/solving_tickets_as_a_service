# ai_tech_advance — AI Capability Advancement Platform

**Date**: 2026-07-28
**Status**: Draft
**Repo**: github.com/Aimino-Tech/ai_tech_advance
**Linear Project**: ai-tech-advance (under Aimino team)

---

## 1. Vision

Bridge the quality gap between cheap models (DeepSeek V4 Flash, $0.28/Mtok) and frontier models (Claude Fable 5, $50/Mtok) using prompt-layer knowledge distillation. No weight fine-tuning. No retraining. Just structured knowledge injected at inference time via the Agent Skills standard (SKILL.md).

The core loop: **Fable traces → distill into SKILL.md → inject into DeepSeek → run scenarios → score → graph trend → iterate.**

---

## 2. Key Insight

The gap is real (52.6% vs 80.3% on SWE-bench Pro, 178x cost difference). Multiple research-validated approaches exist for bridging it at the prompt layer:

- **fable5-skills**: 5 SKILL.md files distilled from 4,665 real Fable 5 chain-of-thought traces. Covers reasoning, coding, debugging, architecture, verification.
- **down-skilling**: 13 documented failure-mode gaps with tested mitigations for small models vs frontier models. Gap catalog gives us a structured mapping from *what the weak model gets wrong* → *what instruction to inject*.
- **dojo.md**: Training arena that runs agents through scenarios, scores 0-100, generates per-model SKILL.md graduates. The automated counterpart to manual distillation.
- **Thinking with Reasoning Skills (TRS)**: ACL 2026 — skill cards reduce thinking tokens while improving accuracy for weaker models.
- **Prompt-Level Distillation (PLD)**: Google 2026 — Gemma-3 4B jumped 57%→90% Macro F1 via structured system prompts.

**The moat**: We own the measurement. Without scoring, we're blind. The scoring system (SQLite + git + trend dashboard) is the differentiator — it tells us iteration-over-iteration whether we're actually improving.

---

## 3. Threat Model (Adversarial Findings)

Key risks identified by adversarial review:

| Risk | Severity | Mitigation |
|------|----------|------------|
| Prompt-layer skill transfer may not work for our model/task | CRITICAL | Build validation into first iteration: measure SWE-bench score before and after skill injection |
| Fable is both knowledge source AND judge → circular optimization | CRITICAL | Use independent evaluation (SWE-bench, not just dojo scenario scores) as the ground truth metric |
| dojo.md may not support DeepSeek V4 Flash as agent | HIGH | Verify in first week; have fallback pipeline using direct agent harness |
| Down-skilling gaps documented for different model era | HIGH | Treat as starting point, not gospel; calibrate against DeepSeek failures |
| Run-to-run score variance may obscure real improvement | HIGH | Multiple runs per configuration; report mean + stddev |
| Scoring proxy: optimizing dojo scenarios ≠ real quality | HIGH | SWE-bench as external validation gate; dojo scores are leading indicators, not targets |

---

## 4. Repo Structure

```
ai_tech_advance/
├── README.md
├── skills/                          # SKILL.md files
│   ├── fable-think/                 # From fable5-skills
│   ├── fable-code/
│   ├── fable-debug/
│   ├── fable-architect/
│   ├── fable-verify/
│   └── down-skilling/               # Gap catalog adapted for DeepSeek
├── courses/                         # dojo.md YAML scenario courses
│   ├── deepseek-baseline/           # 10-20 scenarios measuring base capability
│   └── progressive/                 # Increasingly hard scenarios
├── benchmark/                       # Scoring system
│   ├── schema.sql                   # DDL (3 tables: runs, scenarios, scenario_results)
│   ├── db/                          # Git-committed SQLite databases
│   ├── eval.py                      # Scenario runner
│   ├── report.py                    # HTML generator (Chart.js)
│   └── results/                     # Generated HTML reports
├── traces/                          # Reference Fable traces (HF dataset)
│   └── fable5-originals/            # Sample traces for analysis
├── docs/                            # Methodology, calibration data
│   ├── calibration/                 # Per-model gap analysis
│   └── research/                    # Papers and references
└── AGENTS.md                        # Team setup for running this repo
```

---

## 5. Scoring System

**Three-tier measurement** (from scoring-architect design):

- **Tier 1 — Scenario Pass/Fail**: Binary per test case. Fast, objective.
- **Tier 2 — Course Score**: 0-100 normalized across a scenario suite.
- **Tier 3 — Skill Delta**: -100 to +100 per capability (comprehension, debugging, test-writing, documentation). This is the metric that tells us *which* capability regressed.

**Collection pipeline**: eval.py → scenario_results → dojo.db → report.py → dojo.html

**Storage**: Single SQLite file (`benchmark/db/dojo.db`), git-committed with each run. `git log --all --oneline -- dojo.db` = full audit trail. `git diff` = exactly which scenarios regressed.

**Visualization**: Static Chart.js HTML page with:
- Course score over time (line chart, multi-model)
- Skill delta heatmap
- Latest run summary
- Pass/fail breakdown per scenario

---

## 6. Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      ai_tech_advance                         │
│                                                              │
│  skills/           courses/          benchmark/              │
│  ┌─────────┐      ┌──────────┐      ┌──────────────┐       │
│  │fable5   │      │baseline  │      │eval.py       │       │
│  │-skills  │───▶  │scenarios │─────▶│report.py     │       │
│  │         │      │          │      │dojo.db       │       │
│  │down-    │      │progressive│     │dojo.html     │       │
│  │skilling │      │scenarios │      │              │       │
│  └─────────┘      └──────────┘      └──────────────┘       │
│        │                │                                    │
│        ▼                ▼                                    │
│  Agent loads Skill   Agent runs course                       │
│  at inference time   scored by judge model                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Linear Project Structure

**Project**: ai-tech-advance (under Aimino team)

**Initial tickets**:
1. **Create repo scaffold** — directory structure, README, LICENSE
2. **Import fable5-skills** — copy 5 SKILL.md files, verify they load
3. **Import down-skilling gap catalog** — adapt 13 gaps for DeepSeek V4 Flash
4. **Build scoring system** — schema.sql, eval.py, report.py, dojo.html
5. **Create baseline course** — 10-20 scenarios measuring base DeepSeek capability
6. **Run baseline** — establish score without skills, commit to git
7. **Run with skills** — inject fable5 skills, measure delta
8. **Iterate** — progressively refine skills based on score deltas

---

## 8. Verification Gate

Before declaring any run "better":
1. Score ≥ 3 runs (mean + stddev, not single data point)
2. SWE-bench sample as external validation (not just dojo scenarios)
3. `git diff benchmark/db/dojo.db` shows the regression evidence
4. Skill delta table shows *which* capability improved/regressed
