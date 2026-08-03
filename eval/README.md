# SYNTARO Eval Pipeline

Measure agent fix success rate, detect regressions, and drive the OSS→paid conversion funnel.

## Quickstart

```bash
# Run the eval suite
npx promptfoo eval

# View results in the promptfoo web UI
npx promptfoo view
```

## Adding Tests

Create test case YAML files in `eval/test-cases/`. Each file defines input issues and expected outcomes:

```yaml
# eval/test-cases/example-test.yaml
description: "Simple bug fix"
prompts:
  - "Fix the bug in src/utils/validate.ts where email validation rejects valid addresses"
tests:
  - description: "Agent produces a valid fix"
    assert:
      - type: contains-json
        value:
          fixReady: true
      - type: contains-text
        value: "validate.ts"
```

## Directory Structure

```
eval/
├── promptfooconfig.yaml      # Promptfoo configuration
├── tsconfig.json             # TypeScript config (extends root)
├── langfuse-config.ts        # LangFuse client initialization
├── providers/
│   └── syntaro-agent.ts         # Custom provider for SYNTARO agent (to be implemented)
├── test-cases/               # Test case YAML files
├── results/                  # Eval output (gitignored)
└── README.md                 # This file
```

## Interpreting Results

After running `npx promptfoo eval`:

1. Open the promptfoo web UI: `npx promptfoo view`
2. Review pass/fail rates across test cases
3. Check LangFuse traces for detailed agent behavior (if configured)
4. Results are stored in `eval/results/` as JSON

## Configuration

Tracing is configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `LANGFUSE_HOST` | `http://localhost:3000` | LangFuse server URL |
| `LANGFUSE_PUBLIC_KEY` | — | LangFuse public key |
| `LANGFUSE_SECRET_KEY` | — | LangFuse secret key |
