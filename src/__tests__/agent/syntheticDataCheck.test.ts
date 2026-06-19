import { describe, expect, it, vi } from 'vitest';
import { gateSyntheticDataCheck } from '../../agent/qualityGates.js';

function createSandbox() {
  return { exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }) } as any;
}

describe('gateSyntheticDataCheck', () => {
  let sandbox: any;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  it('passes when no diff provided', async () => {
    const result = await gateSyntheticDataCheck(sandbox, '');
    expect(result.passed).toBe(true);
  });

  it('flags large hardcoded data array without fetch call', async () => {
    const diff = `+ const users = [
+   { id: 1, name: "Alice", email: "alice@example.com" },
+   { id: 2, name: "Bob", email: "bob@example.com" },
+   { id: 3, name: "Charlie", email: "charlie@example.com" },
+   { id: 4, name: "Diana", email: "diana@example.com" },
+   { id: 5, name: "Eve", email: "eve@example.com" },
+   { id: 6, name: "Frank", email: "frank@example.com" },
+ ];
`;
    const result = await gateSyntheticDataCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('hardcoded');
  });

  it('passes when large array has matching fetch call', async () => {
    const diff = `+ const response = await fetch('/api/users');
+ const users = await response.json();
`;
    const result = await gateSyntheticDataCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });

  it('flags placeholder values in generated data', async () => {
    const diff = `+ const items = [
+   { id: 1, name: "test", email: "test@example.com" },
+   { id: 2, name: "foo", email: "foo@bar.com" },
+   { id: 3, name: "bar", email: "bar@example.com" },
+   { id: 4, name: "sample", email: "sample@test.com" },
+ ];
+ return items;`;
    const result = await gateSyntheticDataCheck(sandbox, diff);
    expect(result.passed).toBe(false);
  });

  it('flags data claim without matching API call', async () => {
    const diff = `+ // Fetch users from API
+ const processed = users.filter(u => u.active);
`;
    const result = await gateSyntheticDataCheck(sandbox, diff);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('fetch');
  });

  it('passes on legitimate code with real API calls', async () => {
    const diff = `+ const response = await fetch('/api/users');
+ const data = await response.json();
+ return data.map((u: any) => u.name);
`;
    const result = await gateSyntheticDataCheck(sandbox, diff);
    expect(result.passed).toBe(true);
  });
});
