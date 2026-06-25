# Environment Sanitization

STAS runs OpenCode agents in sandboxed environments. Without sanitization, the
host process's full environment (including API keys, tokens, database URLs, and
other secrets) would be visible to the agent — a significant security risk.

This document describes the three-layer defense STAS uses to protect secrets.

---

## Architecture

```
┌──────────────────────────┐
│   Host `process.env`     │  ← Full environment (secrets + operational)
│                          │
│   ┌──────────────────┐   │
│   │  env-validate.ts  │   │  Layer 1: Startup gate
│   │  (dotenv-safe)    │   │  Exits early if critical vars missing
│   └──────────────────┘   │
│          │               │
│          ▼               │
│   ┌──────────────────┐   │
│   │  env-allowlist.ts │   │  Layer 2: Allowlist
│   │  (what's safe)    │   │  Only operational vars pass through
│   └──────────────────┘   │
│          │               │
│          ▼               │
│   ┌──────────────────┐   │
│   │ env-sanitizer.ts  │   │  Layer 3: Sanitizer
│   │ (strip + redact)  │   │  Strips non-allowed, redacts in logs
│   └──────────────────┘   │
│          │               │
│          ▼               │
│   ┌──────────────────┐   │
│   │   logger.ts       │   │  Layer 4: Pino redact
│   │ (pino redact)     │   │  Catches secrets in structured logs
│   └──────────────────┘   │
│          │               │
│          ▼               │
│   ┌──────────────────┐   │
│   │ Agent / Sandbox   │   │  ← Only safe vars reach here
│   └──────────────────┘   │
└──────────────────────────┘
```

## 1. Startup Validation (`src/security/env-validate.ts`)

At process startup, `validateRequiredEnvOnStartup()` checks that critical
environment variables (`GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`) are set.
If any are missing, it logs a clear message and exits with code 1.

Import in `src/index.ts` or `src/config.ts`:

```ts
import { validateRequiredEnvOnStartup } from './security/env-validate.js';
validateRequiredEnvOnStartup();
```

## 2. Allowlist (`src/security/env-allowlist.ts`)

The `ALLOWED_VARS` set defines which environment variable names are safe to
pass to agents. Only these vars survive `sanitizeEnv()`:

| Category | Examples |
|---|---|
| OS / runtime | `PATH`, `HOME`, `NODE_ENV`, `LOG_LEVEL`, `TZ`, `SHELL` |
| STAS operational | `STAS_LABEL`, `STAS_MODE`, `BOT_NAME`, `STAS_PORT` |
| GitHub routing (no tokens) | `GITHUB_REPOSITORY`, `GITHUB_OWNER`, `GITHUB_ISSUE_NUMBER` |
| OpenCode routing | `OPENCODE_URL`, `OPENCODE_MODEL` |
| Sandbox config | `E2B_TEMPLATE_ID`, `SANDBOX_MEMORY_LIMIT`, etc. |
| Timeouts / limits | `FIX_TIMEOUT_MS`, `MAX_AGENT_ITERATIONS`, etc. |

**Sensitive vars are EXCLUDED**: `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`,
`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, etc.

### Per-repo / Per-plan extras

Set `STAS_ENV_ALLOWLIST_EXTRA` to a comma-separated list of additional
allowed env var names:

```env
STAS_ENV_ALLOWLIST_EXTRA=CUSTOM_VAR,MY_FEATURE_FLAG
```

## 3. Sanitizer (`src/security/env-sanitizer.ts`)

Three functions:

### `sanitizeEnv(input)`

Strips any env var not in the allowlist. Returns a new object with only
safe vars. Use before passing environment to an agent or sandbox:

```ts
const safeEnv = sanitizeEnv(process.env);
// safeEnv now contains only allowed vars
```

### `redactSecrets(input)`

Replaces secret-looking values with `[REDACTED]` in a string. Applies
patterns for:

- OpenAI / Anthropic API keys (`sk-...`, `sk-ant-...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- GitLab tokens (`glpat-...`)
- Stripe keys (`sk_live_...`, `sk_test_...`)
- Slack tokens (`xoxb-...`, `xapp-...`)
- JWT tokens (three base64url segments)
- Bearer tokens
- Labelled secrets (`token=`, `password=`, `api_key=`)
- PEM private keys
- Connection strings with credentials

Use before logging any string that may contain env values:

```ts
logger.info(redactSecrets(`Processing with key=${process.env.API_KEY}`));
```

### `redactObject(input)`

Recursively walks an object tree and redacts any string values matching
secret patterns, plus redacts known sensitive key names (`token`,
`password`, `secret`, `apiKey`, etc.).

### `validateRequiredEnv(list)`

Checks that all named env vars are set and non-empty. Returns
`{ missing: string[] }`:

```ts
const { missing } = validateRequiredEnv(['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET']);
if (missing.length > 0) {
  console.error('Missing:', missing);
}
```

## 4. Logger Redaction (`src/utils/logger.ts`)

The Pino logger is configured with a built-in `redact` option that
automatically censors sensitive fields in structured log objects:

```ts
redact: {
  paths: [
    'req.headers.authorization',
    '*.apiKey',
    '*.token',
    '*.password',
    '*.secret',
    '*.privateKey',
    // ... many more
  ],
  censor: '[REDACTED]',
}
```

This means if you log an object containing `{ apiKey: 'sk-secret' }`,
the output will contain `{ apiKey: '[REDACTED]' }` — no manual redaction
needed for structured logs.

## 5. Agent Dispatch Integration

In the agent dispatch pipeline (`src/agent/issueAgent.ts`), environment
variables are sanitized before being passed to the OpenCode agent:

```ts
import { sanitizeEnv, redactSecrets } from '../security/env-sanitizer.js';

// Before dispatching to OpenCode:
const safeEnv = sanitizeEnv(process.env);

// Redact any env values in log messages:
logger.info({ env: safeEnv }, 'Agent environment prepared');
```

## Testing

Run the sanitizer tests:

```bash
npx vitest run src/__tests__/security/env-sanitizer.test.ts
```

The test suite covers:
- Allowlist filtering removes unexpected vars
- Allowlist keeps expected operational vars
- Secret patterns are redacted from strings (API keys, tokens, JWTs, PEM keys, connection strings)
- Required var validation works (present, missing, empty)
- Object redaction handles nested objects and arrays
- Pino redact configuration loads correctly

## Adding New Patterns

To add a new secret pattern:

1. Add the regex to `SECRET_PATTERNS` in `src/security/env-sanitizer.ts`
2. Add a test case in `src/__tests__/security/env-sanitizer.test.ts`
3. If it's a structured key, also add it to the pino `redact.paths` in `src/utils/logger.ts`

## Security Model

```
                    Trust Boundary
┌─────────────────────────────────────────────────┐
│                  Host Process                    │
│  ┌──────────────┐   ┌──────────────────────┐   │
│  │  config.ts   │   │  env-validate.ts      │   │
│  │  (Zod)       │   │  (startup gate)      │   │
│  └──────────────┘   └──────────────────────┘   │
│         │                                       │
│         ▼                                       │
│  ┌──────────────────────────────────────────┐   │
│  │          env-sanitizer.ts                 │   │
│  │  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │  Allowlist   │  │  Secret Redact   │  │   │
│  │  └──────────────┘  └──────────────────┘  │   │
│  └──────────────────────────────────────────┘   │
│         │                                       │
╞═════════╧═══════════════════════════════════════╡
│         │           Trust Boundary              │
╞═════════╧═══════════════════════════════════════╡
│         ▼                                       │
│  ┌──────────────────────────────────────────┐   │
│  │     Agent / Sandbox                      │   │
│  │     (only safe vars visible)             │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

No secret ever crosses the trust boundary.
