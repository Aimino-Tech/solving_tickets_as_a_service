# @syntaro/github-client

GitHub App client for SYNTARO — authentication, PR creation, and structured message templates.

## Install

```bash
npm install @syntaro/github-client
```

## Usage

### Authentication

```typescript
import { createAuth, createInstallationOctokit, getInstallationToken } from '@syntaro/github-client';

// Create auth strategy from GitHub App credentials
const auth = createAuth({
  appId: 123456,
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
});

// Get an Octokit scoped to an installation
const octokit = await createInstallationOctokit(auth, 789012);

// Or get a raw installation token
const token = await getInstallationToken(auth, 789012);
```

### Loading Private Keys

```typescript
import { loadPrivateKey } from '@syntaro/github-client';
import { readFileSync } from 'node:fs';

// Load from a file
const key = loadPrivateKey(
  { appId: 123456, privateKey: '/etc/secrets/key.pem' },
  { readFileSync: (path) => readFileSync(path, 'utf-8') },
);
```

PKCS#1 keys are automatically converted to PKCS#8 for Node 20+ / OpenSSL 3 compatibility.

### Creating PRs

```typescript
import { dispatchAction } from '@syntaro/github-client';

const result = await dispatchAction(
  {
    octokit,
    postComment: (issueNumber, body) =>
      octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body }),
    pushBranch: async (branchName) => { /* push to remote */ },
    getChangedFiles: async (branch, base) => { /* git diff */ return ['src/index.ts']; },
  },
  {
    issueNumber: 42,
    issueTitle: 'Fix login bug',
    agentResult: { summary: 'Fixed', fixReady: true, confidence: 'high', verification: { details: [] } },
    repoOwner: 'my-org',
    repoName: 'my-repo',
  },
);
```

### Message Templates

```typescript
import { highConfidenceIssueComment, buildPRBody } from '@syntaro/github-client';

const comment = highConfidenceIssueComment(42, { summary: 'Fixed', verification: { details: [] } });

const prBody = buildPRBody({
  issueNumber: 42,
  result: { summary: 'Fixed', verification: { details: [] } },
  fileLinks: ['src/index.ts'],
  isDraft: false,
  branchName: 'fix/42-bug',
});
```

## API

### `auth.ts`

| Export | Description |
|--------|-------------|
| `loadPrivateKey(config, options?)` | Load and normalize PEM private key (auto PKCS#1→PKCS#8) |
| `convertPkcs1ToPkcs8(pem)` | Convert PKCS#1 RSA key to PKCS#8 format |
| `createAuth(config, loadKey?)` | Create Octokit auth strategy from GitHub App config |
| `createAppOctokit(config, loadKey?)` | Create app-level Octokit instance |
| `createInstallationOctokit(auth, installationId)` | Create installation-scoped Octokit |
| `getInstallationToken(auth, installationId)` | Get raw installation token |

### `dispatch.ts`

| Export | Description |
|--------|-------------|
| `dispatchAction(config, params)` | Dispatch action based on agent result confidence |

### `messages.ts`

| Export | Description |
|--------|-------------|
| `highConfidenceIssueComment(prNumber, result, botName?)` | PR ready for review |
| `draftIssueComment(prNumber, result, botName?)` | Draft PR ready |
| `lowConfidenceComment(result, testOutput, botName?)` | Tests need attention |
| `noFixComment(result, relevantPRs?, botName?)` | Could not fix |
| `noResultComment(botName?)` | Unexpected result |
| `investigationComment(summary, botName?)` | Investigation findings |
| `alreadyFixedComment(result, botName?)` | Already fixed |
| `errorComment(message, botName?)` | Error notification |
| `featureSkipComment(botName?)` | Feature request detected |
| `questionSkipComment(botName?)` | Question detected |
| `timeoutComment(phase, timeoutMs, botName?)` | Phase timeout |
| `retryComment(attempt, model, error, botName?)` | Retry notification |
| `phantomIssueComment(missingFiles, skipReason, botName?)` | Phantom issue |
| `ciFailureComment(prNumber, failedChecks, botName?)` | CI failures |
| `regressionBlockComment(result, botName?)` | Regression blocked |
| `buildPRBody(params)` | Full PR body |
| `verificationWarningComment(result, botName?)` | Verification warnings |

## License

MIT
