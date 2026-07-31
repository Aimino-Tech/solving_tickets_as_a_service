# Continuity eval harness (AIM-4445)

Proves the STAS Slack chat bot never "talks to a gold fish": a conversation
that is interrupted — by pod death, gateway restart, or scale-to-zero —
must continue without the user having to re-explain anything.

## Eval spec

> "We need to run 10x, with 10 follow-up messages first, without talking to a
> gold fish."

For every scenario:

- **10 runs** of the same conversation (`N=10`).
- Each run is a **10-turn** conversation (`totalTurns`).
- Turns 1–3 **seed facts** (not checked).
- Turns 4–10 **reference those facts implicitly** and must be **goldfish-free**
  (the assistant never asks the user to re-explain, re-state, or remind it of
  what was already established).
- A run **passes with ZERO goldfish turns**; a scenario **passes at
  ≥ 9/10 runs** (`PASS_RATE = 0.9`).

The no-memory baseline (`GoldfishSUT`) **must fail** every scenario — if it
passes, the harness cannot tell memory from no memory and is itself broken.

## Layout

```
eval/continuity/
  fixtures/continuity-scenarios.ts   # 3 scenarios, scripted replies
  lib/goldfish-detector.ts           # flags re-explanation requests
  lib/sut.ts                         # ChatSUT + ScriptedMemorySUT + GoldfishSUT
  lib/real-sut.ts                    # RealSUT — live opencode-serve conversation
  lib/runner.ts                      # run matrix (N x turns) + scoring
  report.ts                          # JSON + markdown report writer
  continuity.eval.ts                 # driver: N=10, all scenarios (tsx)
  rehydrate.eval.ts                  # driver: kills after turns 3,5,7 (tsx)
  real-sut.eval.ts                   # driver: real conversations (tsx)
  __tests__/                         # vitest unit tests + CI gate
  results/                           # reports (gitignored)
```

## Usage

```bash
# Unit tests + CI acceptance gate
npx vitest run eval/continuity

# Full eval drivers (writes reports to results/)
npx tsx eval/continuity/continuity.eval.ts
npx tsx eval/continuity/rehydrate.eval.ts

# REAL conversations against a running opencode serve
# (default: http://127.0.0.1:20888, OPENCODE_API_KEY from env)
npx tsx eval/continuity/real-sut.eval.ts

# Typecheck (src + eval together)
npx tsc -p tsconfig.eval.json --noEmit
```

## Wiring the real SUT

The harness ships with deterministic mocks so CI is green and fast without a
model:

- `ScriptedMemorySUT` — replies from the fixture; simulates a perfect-memory
  agent and validates the harness + detector logic.
- `GoldfishSUT` — always asks for re-explanation; the failing baseline.

The real system under test (STAS gateway → session store → agent memory →
opencode session, AIM-4442/4443) plugs in by implementing the `ChatSUT`
interface (`ask` / `kill` / `reset`) and passing it to `runMatrix`. `kill()`
then maps to pod death; the rehydrate driver verifies the conversation
survives 3 kills with zero goldfish turns. The harness itself has no
dependency on `@opencode-ai/sdk`.

`RealSUT` is the live implementation: it opens one opencode-serve session per
run (`reset()`), sends each turn via `POST /session/{id}/message` (which
blocks until the assistant turn completes), and returns the joined text
parts. `kill()` aborts the in-flight turn and drops the session. Env knobs:

```bash
REAL_SUT_SCENARIO=project-onboarding   # scenario id (default)
REAL_SUT_RUNS=10                       # conversations to run (default 10)
OPENCODE_URL=http://127.0.0.1:20888    # opencode serve base URL
OPENCODE_API_KEY=...                   # auth key (default: process env)
```

The driver gate is strict: exit 0 only when every run completes without
errors AND every run is goldfish-free (10/10 conversations x 10/10 turns).
