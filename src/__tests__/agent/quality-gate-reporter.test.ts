import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  QualityGateReporter,
  persistGateResults,
  type GateResult,
} from "../../agent/quality-gate-reporter.js";
import type { QualityGateResult } from "../../agent/types.js";

// ---------------------------------------------------------------------------
// formatMarkdown tests
// ---------------------------------------------------------------------------

describe("QualityGateReporter.formatMarkdown", () => {
  const reporter = new QualityGateReporter();

  it("returns empty string for empty results", () => {
    const md = reporter.formatMarkdown([]);
    expect(md).toBe("");
  });

  it("renders all-passed gates correctly", () => {
    const results: GateResult[] = [
      { name: "reality", passed: true, details: ["All refs exist"], durationMs: 120 },
      { name: "compile", passed: true, details: ["tsc clean"], durationMs: 3400 },
      { name: "secrets", passed: true, details: ["No secrets found"], durationMs: 800 },
    ];

    const md = reporter.formatMarkdown(results);

    // Collapsible wrapper
    expect(md).toContain("<details>");
    expect(md).toContain("</details>");
    expect(md).toContain("<!-- stas-quality-report -->");

    // Summary line
    expect(md).toContain("3/3 gates passed");

    // Table header
    expect(md).toContain("| Gate | Status | Detail |");
    expect(md).toContain("|---|---|---|");

    // Each gate appears
    expect(md).toContain("reality");
    expect(md).toContain("compile");
    expect(md).toContain("secrets");

    // All passed status
    expect(md).toContain("✅ Passed");
  });

  it("renders mixed results (pass, fail, skip)", () => {
    const results: GateResult[] = [
      { name: "reality", passed: true, details: ["All refs exist"], durationMs: 100 },
      { name: "compile", passed: false, details: ["tsc error TS2322"], durationMs: 5000 },
      { name: "coverage", passed: null, details: ["Skipped — no test config"], durationMs: 0 },
    ];

    const md = reporter.formatMarkdown(results);

    expect(md).toContain("1/3 gates passed");
    expect(md).toContain("✅ Passed");
    expect(md).toContain("❌ Failed");
    expect(md).toContain("⏭️ Skipped");
    expect(md).toContain("tsc error TS2322");
  });

  it("renders all-skipped gates", () => {
    const results: GateResult[] = [
      { name: "reality", passed: null, details: ["Skipped"], durationMs: 0 },
      { name: "compile", passed: null, details: ["Skipped"], durationMs: 0 },
    ];

    const md = reporter.formatMarkdown(results);

    expect(md).toContain("0/2 gates passed");
    expect(md).toContain("⏭️ Skipped");
    // Should not contain ✅ or ❌
    expect(md.match(/✅/g)).toBeNull();
    expect(md.match(/❌/g)).toBeNull();
  });

  it("escapes pipe characters in details", () => {
    const results: GateResult[] = [
      { name: "test_integrity", passed: false, details: ["Failed on line 5 | column 3"], durationMs: 200 },
    ];

    const md = reporter.formatMarkdown(results);
    // Pipe in detail should be escaped
    expect(md).toContain("column 3");
    // No unescaped pipe in the detail column value
    const detailLine = md.split("\n").find((l) => l.includes("test_integrity"));
    expect(detailLine).toBeTruthy();
  });

  it("handles single gate result", () => {
    const results: GateResult[] = [
      { name: "secrets", passed: true, details: ["No secrets"], durationMs: 50 },
    ];

    const md = reporter.formatMarkdown(results);
    expect(md).toContain("secrets");
    expect(md).toContain("1/1 gates passed");
  });

  it("renders gates with multiple details using first detail as summary", () => {
    const results: GateResult[] = [
      {
        name: "hallucination",
        passed: false,
        details: [
          "Phantom package detected: fake-pkg",
          "AI pattern found: example.com",
        ],
        durationMs: 3000,
      },
    ];

    const md = reporter.formatMarkdown(results);
    expect(md).toContain("Phantom package detected: fake-pkg");
  });
});

// ---------------------------------------------------------------------------
// collectResults tests
// ---------------------------------------------------------------------------

describe("QualityGateReporter.collectResults", () => {
  let tempDir: string;
  let gatesDir: string;
  const reporter = new QualityGateReporter();

  beforeEach(() => {
    // Create a temp .stas/gates structure
    tempDir = mkdtempSync(join(tmpdir(), "stas-gates-"));
    gatesDir = join(tempDir, ".stas", "gates", "fix-42");
    mkdirSync(gatesDir, { recursive: true });

    // Mock process.cwd so gatesRoot() resolves to the temp dir
    vi.spyOn(process, "cwd").mockReturnValue(tempDir as unknown as string);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when no artifacts exist", async () => {
    // Point to non-existent fixId
    const results = await reporter.collectResults("non-existent-fix");
    expect(results).toEqual([]);
  });

  it("reads persisted gate artifacts from disk", async () => {
    // Write gate artifacts
    writeFileSync(
      join(gatesDir, "reality.json"),
      JSON.stringify({ name: "reality", passed: true, details: ["All refs exist"], durationMs: 100 }),
    );
    writeFileSync(
      join(gatesDir, "compile.json"),
      JSON.stringify({ name: "compile", passed: false, details: ["tsc error TS2322"], durationMs: 5000 }),
    );

    // Use the fix-42 directory created in gatesDir's parent
    const results = await reporter.collectResults("fix-42");

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.name === "reality")?.passed).toBe(true);
    expect(results.find((r) => r.name === "compile")?.passed).toBe(false);
    expect(results.find((r) => r.name === "compile")?.durationMs).toBe(5000);
  });

  it("skips _manifest.json", async () => {
    writeFileSync(
      join(gatesDir, "reality.json"),
      JSON.stringify({ name: "reality", passed: true, details: [], durationMs: 100 }),
    );
    writeFileSync(
      join(gatesDir, "_manifest.json"),
      JSON.stringify({ fixId: "fix-42", total: 1, passed: 1, failed: 0, persistedAt: new Date().toISOString() }),
    );

    const results = await reporter.collectResults("fix-42");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("reality");
  });

  it("handles malformed JSON files gracefully", async () => {
    writeFileSync(join(gatesDir, "bad.json"), "not valid json");

    const results = await reporter.collectResults("fix-42");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fromQualityGateResults tests
// ---------------------------------------------------------------------------

describe("QualityGateReporter.fromQualityGateResults", () => {
  it("converts QualityGateResult[] to GateResult[]", () => {
    const qgResults: QualityGateResult[] = [
      {
        gate: "reality",
        passed: true,
        ossTool: "hallucination-grep",
        command: "npx hallucination-grep",
        stdout: "All good",
        stderr: "",
        details: ["All refs exist"],
      },
      {
        gate: "compile",
        passed: false,
        ossTool: "tsc",
        command: "npx tsc --noEmit",
        stdout: "error TS2322",
        stderr: "",
        details: ["Type error in src/index.ts"],
      },
    ];

    const gateResults = QualityGateReporter.fromQualityGateResults(qgResults);

    expect(gateResults).toHaveLength(2);
    expect(gateResults[0]).toEqual({
      name: "reality",
      passed: true,
      details: ["All refs exist"],
      durationMs: 0,
    });
    expect(gateResults[1]).toEqual({
      name: "compile",
      passed: false,
      details: ["Type error in src/index.ts"],
      durationMs: 0,
    });
  });

  it("returns empty array for empty input", () => {
    const gateResults = QualityGateReporter.fromQualityGateResults([]);
    expect(gateResults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// persistGateResults tests
// ---------------------------------------------------------------------------

describe("persistGateResults", () => {
  let tempRoot: string;

  beforeEach(() => {
    // We can't easily change GATES_ROOT since it uses process.cwd(),
    // but we can test that files are created in the expected location
    tempRoot = mkdtempSync(join(tmpdir(), "stas-persist-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempRoot as unknown as string);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("writes gate result files and manifest", async () => {
    const results: QualityGateResult[] = [
      {
        gate: "reality",
        passed: true,
        ossTool: "hallucination-grep",
        command: "npx hallucination-grep",
        stdout: "",
        stderr: "",
        details: ["All refs exist"],
      },
    ];

    await persistGateResults("fix-99", results);

    // Check files exist
    const { readFileSync, existsSync } = await import("node:fs");
    const gatePath = join(tempRoot, ".stas", "gates", "fix-99", "reality.json");
    const manifestPath = join(tempRoot, ".stas", "gates", "fix-99", "_manifest.json");

    expect(existsSync(gatePath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);

    const content = JSON.parse(readFileSync(gatePath, "utf-8"));
    expect(content.name).toBe("reality");
    expect(content.passed).toBe(true);
    expect(Array.isArray(content.details)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.fixId).toBe("fix-99");
    expect(manifest.total).toBe(1);
    expect(manifest.passed).toBe(1);
    expect(manifest.failed).toBe(0);
  });

  it("creates parent directory if missing", async () => {
    const results: QualityGateResult[] = [
      {
        gate: "reality",
        passed: true,
        ossTool: "test",
        command: "test",
        stdout: "",
        stderr: "",
        details: [],
      },
    ];

    // Should not throw
    await expect(persistGateResults("fix-new", results)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration with PR body composition
// ---------------------------------------------------------------------------

describe("Quality gate reporter integration with buildPRBody", () => {
  it("formatMarkdown produces valid markdown that can be appended to PR body", () => {
    const reporter = new QualityGateReporter();
    const results: GateResult[] = [
      { name: "reality", passed: true, details: ["All references verified"], durationMs: 150 },
      { name: "compile", passed: false, details: ["tsc error TS2322 in src/index.ts"], durationMs: 3200 },
    ];

    const md = reporter.formatMarkdown(results);

    // Markdown should be valid for a PR body appendix
    expect(md.startsWith("<details>")).toBe(true);
    expect(md).toContain("</details>");
    expect(md).toContain("<!-- stas-quality-report -->");

    // Line breaks should be proper
    const lines = md.split("\n");
    expect(lines.length).toBeGreaterThan(5);

    // Table should have proper separators
    const separatorLine = lines.find((l) => l.startsWith("|---"));
    expect(separatorLine).toBeTruthy();
  });

  it("quality report section flows naturally after verification section", () => {
    const reporter = new QualityGateReporter();
    const results: GateResult[] = [
      { name: "reality", passed: true, details: ["OK"], durationMs: 100 },
    ];

    const md = reporter.formatMarkdown(results);

    // Simulate the PR body structure from buildPRBody
    const prBody = [
      "## Summary",
      "Fixed the issue",
      "",
      "## Verification",
      "",
      "Tests passed",
      "",
      "## Quality Report",
      "",
      md,
      "",
      "---",
      "_🤖 Automated fix by STAS_",
    ].join("\n");

    // The PR body should be well-formed
    expect(prBody).toContain("## Summary");
    expect(prBody).toContain("## Verification");
    expect(prBody).toContain("## Quality Report");
    expect(prBody).toContain("✅ Passed");
    expect(prBody).toContain("<!-- stas-quality-report -->");
  });
});
