# Adding a New Platform

This guide describes how to add support for a new Git hosting platform to SYNTARO.

## Step-by-Step

### 1. Implement PlatformWebhook Interface

Create `src/webhooks/{platform}.ts`:

```typescript
import type { PlatformWebhook, PlatformWebhookEvent, WebhookPlatform } from './base.js';

export class {Platform}Webhook implements PlatformWebhook {
  readonly platform: WebhookPlatform = '{platform}';
  
  verify(payload: string, signature: string, secret: string): boolean {
    // Implement signature verification
  }
  
  parse(event: string, payload: unknown): PlatformWebhookEvent | null {
    // Parse platform-specific webhook payload to NormalizedIssue
  }
}
```

### 2. Implement PlatformClient Interface

Create `src/platforms/{platform}/index.ts`:

```typescript
import type { PlatformClient, CreatePullRequestParams, PlatformConfig } from '../interface.js';

export class {Platform}Client implements PlatformClient {
  readonly platform = '{platform}';
  
  constructor(private config: PlatformConfig) {}
  
  async createComment(repo: string, issueNumber: number, body: string): Promise<void> {
    // POST /repos/{repo}/issues/{issueNumber}/comments
  }
  
  async createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }> {
    // POST /repos/{owner}/{repo}/pulls
  }
  
  // Implement remaining methods...
}
```

### 3. Register in Registry

Add to `src/platforms/registry.ts`:

```typescript
case '{platform}':
  return new {Platform}Client(config);
```

### 4. Add Environment Variables

Add to `src/config.ts`:

```typescript
{PLATFORM}_TOKEN: z.string().optional(),
{PLATFORM}_WEBHOOK_SECRET: z.string().optional(),
```

### 5. Add Eval Test Fixtures

Create `eval/test-cases/{platform}/` with test fixtures.

### 6. Add CI Configuration

Add platform-specific CI config if different from GitHub Actions.

### 7. Write Platform Setup Doc

Create `docs/platforms/{platform}-setup.md` with setup instructions.
