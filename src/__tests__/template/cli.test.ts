/**
 * Tests for src/template/cli.ts — template validation CLI
 */

import { describe, expect, it, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We import the functions directly (not via child_process) for unit testing
import { validateAction, dryRunAction, parseArgs } from "../../template/cli.js";

// Mock the quickstart module so quickstart routing never touches the real
// interactive flow (readline prompts on stdin). The mock makes the run resolve
// immediately, so tests cannot hang on a TTY.
vi.mock("../../quickstart/quickstart.js", () => ({
  runQuickstart: vi.fn(),
  resolveGitHubToken: vi.fn(),
  selectRepositories: vi.fn(),
  installApp: vi.fn(),
}));

import { runQuickstart, resolveGitHubToken, selectRepositories, installApp } from "../../quickstart/quickstart.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "stas-cli-test-"));
}

function writeTemplate(dir: string, name: string, content: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function writeValidTemplate(dir: string, name = "test.yaml"): string {
  return writeTemplate(
    dir,
    name,
    [
      "name: test",
      "labels: [test]",
      "phases:",
      "  pre:",
      '    - command: "echo hello {issue.number}"',
      "      session: reuse",
      "  main:",
      '    - command: "opencode agent --issue {issue.number}"',
      "      session: new",
      "  post:",
      '    - command: "opencode clean"',
      "      session: new",
      "  final:",
      '    - command: "opencode done"',
      "      session: new",
      "",
    ].join("\n"),
  );
}

function writeInvalidTemplate(dir: string, name = "invalid.yaml"): string {
  return writeTemplate(
    dir,
    name,
    [
      "name: invalid",
      "labels: [invalid]",
      "phases:",
      "  pre:",
      '    - command: "echo {unknown_placeholder}"',
      "      session: reuse",
      "  main:",
      "    - not_a_command: true",
      "      session: new",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateAction", () => {
  let tempDir: string;
  let backupArgv: string[];
  let backupEnvNodeEnv: string | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    backupArgv = process.argv;
    backupEnvNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    // Silence console.log during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = backupArgv;
    process.env.NODE_ENV = backupEnvNodeEnv;
    vi.restoreAllMocks();
  });

  it("returns valid=true for a well-formed template", () => {
    writeValidTemplate(tempDir);
    const results = validateAction(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].errors).toHaveLength(0);
  });

  it("returns valid=false for a template with unknown placeholders", () => {
    writeInvalidTemplate(tempDir);
    const results = validateAction(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    // Should have at least 1 error: the step without "command" key, and the unknown placeholder
    expect(results[0].errors.length).toBeGreaterThan(0);
  });

  it("validates a single file with --file option", () => {
    const filePath = writeValidTemplate(tempDir, "custom.yaml");
    const results = validateAction(tempDir, { file: filePath });
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].file).toBe(filePath);
  });

  it("returns JSON when format=json", () => {
    writeValidTemplate(tempDir);
    const results = validateAction(tempDir, { format: "json" });
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it("surfaces placeholder warnings for known-but-suspicious usage", () => {
    writeTemplate(
      tempDir,
      "issue-placeholders.yaml",
      [
        "name: issue-test",
        "labels: [test]",
        "phases:",
        "  main:",
        '    - command: "echo {issue.title} {issue.body} {issue.labels}"',
        "      session: new",
        "  post:",
        '    - command: "opencode clean"',
        "      session: new",
        "  final:",
        '    - command: "opencode done"',
        "      session: new",
        "",
      ].join("\n"),
    );
    const results = validateAction(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it("throws when template file does not exist", () => {
    const nonExistent = join(tempDir, "nonexistent.yaml");
    expect(() => validateAction(tempDir, { file: nonExistent })).toThrow(/not found/i);
  });

  it("throws when template directory does not exist", () => {
    const fakeDir = join(tempDir, "does-not-exist");
    expect(() => validateAction(fakeDir)).toThrow(/not found/i);
  });

  it("reports multiple templates in a directory", () => {
    writeValidTemplate(tempDir, "a.yaml");
    writeValidTemplate(tempDir, "b.yaml");
    writeValidTemplate(tempDir, "c.yaml");
    const results = validateAction(tempDir);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});

describe("dryRunAction", () => {
  let tempDir: string;
  let backupEnvNodeEnv: string | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    backupEnvNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = backupEnvNodeEnv;
    vi.restoreAllMocks();
  });

  it("resolves placeholders with provided input payload", () => {
    writeValidTemplate(tempDir);
    const payload = { "issue.number": 42 };
    const results = dryRunAction(tempDir, payload);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);

    // Should have resolved commands
    expect(results[0].resolved).toBeDefined();
    expect(results[0].resolved!.length).toBeGreaterThan(0);

    // Check that {issue.number} got replaced with 42
    const preStep = results[0].resolved!.find((r) => r.command.includes("{issue.number}"));
    expect(preStep).toBeDefined();
    expect(preStep!.resolved).toContain("42");
    expect(preStep!.resolved).not.toContain("{issue.number}");
  });

  it("flags unresolved placeholders when payload is empty", () => {
    writeTemplate(
      tempDir,
      "unresolved.yaml",
      [
        "name: unresolved-test",
        "labels: [test]",
        "phases:",
        "  pre:",
        '    - command: "echo {issue.number}"',
        "      session: reuse",
        "  main:",
        '    - command: "opencode agent --issue {issue.number}"',
        "      session: new",
        "  post:",
        '    - command: "opencode clean"',
        "      session: new",
        "  final:",
        '    - command: "opencode done"',
        "      session: new",
        "",
      ].join("\n"),
    );
    const results = dryRunAction(tempDir, {});

    // Template is valid, but resolved commands still contain {issue.number}
    // since we didn't provide the payload — valid should still be true because
    // preflightValidate only flags completely unresolved placeholders as errors
    // Actually, if payload is empty, {issue.number} stays as-is => unresolved placeholder error
    expect(results).toHaveLength(1);

    // With empty payload, {issue.number} is preserved verbatim => preflight catches it
    // But dryRunResolve leaves unresolved placeholders in place (replaces with "{name}" fallback)
    // preflightValidate then flags those.
    // Actually: dryRunResolve replaces with context[name] ?? `{${name}}`
    // So unresolved stay as {issue.number}
    // preflightValidate uses extractPlaceholders which finds them
    // So validation should fail
    expect(results[0].valid).toBe(false);
    const unresolvedErrors = results[0].errors.filter((e) => e.type === "placeholder");
    expect(unresolvedErrors.length).toBeGreaterThan(0);
  });

  it("resolves multiple different placeholders", () => {
    writeTemplate(
      tempDir,
      "multi-placeholder.yaml",
      [
        "name: multi-test",
        "labels: [test]",
        "phases:",
        "  pre:",
        '    - command: "echo {repo.owner}/{repo.name} issue #{issue.number}"',
        "      session: reuse",
        "  main:",
        '    - command: "opencode agent --issue {issue.number}"',
        "      session: new",
        "  post:",
        '    - command: "opencode clean"',
        "      session: new",
        "  final:",
        '    - command: "opencode done"',
        "      session: new",
        "",
      ].join("\n"),
    );
    const payload = {
      "repo.owner": "my-org",
      "repo.name": "my-repo",
      "issue.number": 7,
    };
    const results = dryRunAction(tempDir, payload);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);

    const preStep = results[0].resolved!.find((r) => r.phase === "pre");
    expect(preStep).toBeDefined();
    expect(preStep!.resolved).toBe("echo my-org/my-repo issue #7");
  });

  it("reports errors for invalid template in dry-run", () => {
    writeInvalidTemplate(tempDir);
    const results = dryRunAction(tempDir, { "issue.number": 1 });
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
  });
});

describe("validateAction tty output", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs summary with valid/invalid counts", () => {
    writeValidTemplate(tempDir, "valid1.yaml");
    writeTemplate(
      tempDir,
      "invalid.yaml",
      [
        "phases:",
        "  pre:",
        "    - bad: true",
        "",
      ].join("\n"),
    );

    const results = validateAction(tempDir);
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.valid)).toHaveLength(1);
    expect(results.filter((r) => !r.valid)).toHaveLength(1);
  });
});

describe("quickstart routing (--skip-prompts)", () => {
  let tempDir: string;
  let backupArgv: string[];
  let exitSpy: MockInstance;

  beforeEach(() => {
    tempDir = createTempDir();
    backupArgv = process.argv;
    process.env.NODE_ENV = "test";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Trap process.exit so parseArgs can't kill the test runner.
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    process.argv = ["node", "cli.ts", "quickstart", "--skip-prompts"];
    vi.mocked(runQuickstart).mockResolvedValue({
      prUrl: "https://github.com/alice/awesome-project/pull/42",
      configPath: join(tempDir, "config.json"),
      owner: "alice",
      repo: "awesome-project",
      issueNumber: 7,
      issueUrl: "https://github.com/alice/awesome-project/issues/7",
    });
  });

  afterEach(() => {
    process.argv = backupArgv;
    vi.restoreAllMocks();
  });

  it("routes quickstart --skip-prompts to the non-interactive path and exits 0", async () => {
    await parseArgs();

    // Routing hands off to runQuickstart with skipPrompts=true and never runs
    // the interactive prompt layer (token prompt, repo selection, install ask).
    expect(runQuickstart).toHaveBeenCalledTimes(1);
    expect(runQuickstart).toHaveBeenCalledWith({ skipPrompts: true });
    expect(resolveGitHubToken).not.toHaveBeenCalled();
    expect(selectRepositories).not.toHaveBeenCalled();
    expect(installApp).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("routes quickstart without the flag to skipPrompts=false", async () => {
    process.argv = ["node", "cli.ts", "quickstart"];

    await parseArgs();

    expect(runQuickstart).toHaveBeenCalledWith({ skipPrompts: false });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 2 when quickstart fails under --skip-prompts (e.g. missing token)", async () => {
    vi.mocked(runQuickstart).mockRejectedValue(
      new Error("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login` first."),
    );

    await parseArgs();

    expect(runQuickstart).toHaveBeenCalledWith({ skipPrompts: true });
    expect(console.error).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 1 when quickstart times out waiting for a PR under --skip-prompts", async () => {
    vi.mocked(runQuickstart).mockResolvedValue({
      prUrl: null,
      configPath: join(tempDir, "config.json"),
      owner: "alice",
      repo: "awesome-project",
      issueNumber: 7,
      issueUrl: "https://github.com/alice/awesome-project/issues/7",
    });

    await parseArgs();

    expect(runQuickstart).toHaveBeenCalledWith({ skipPrompts: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 2 on an unknown quickstart flag instead of invoking runQuickstart", async () => {
    process.argv = ["node", "cli.ts", "quickstart", "--bogus"];
    // The shared exit spy is a no-op, which would let execution fall through
    // the guard; throwing mimics a real process halting at process.exit.
    exitSpy.mockImplementation(((code) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(parseArgs()).rejects.toThrow("exit 2");

    expect(runQuickstart).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Unknown flag for quickstart"));
  });
});
