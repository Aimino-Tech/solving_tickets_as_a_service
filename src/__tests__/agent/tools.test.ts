/**
 * Unit tests for agent tools (tools.ts).
 *
 * Tests the tool factory, dispatch mechanism, OpenAI conversion,
 * and each of the 15 individual tool handlers for structure, correctness,
 * and edge-case handling.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildTools,
  dispatchNamedTool,
  toOpenAiTools,
} from "../../agent/tools.js";
import type { SandboxTools } from "../../agent/tools.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a mocked SandboxTools instance with sensible defaults.
 * Individual tests can override via mockResolvedValue / mockResolvedValueOnce.
 */
function createMockSandbox() {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    runTests: vi
      .fn()
      .mockResolvedValue({ passed: true, output: "", command: "", durationMs: 0 }),
    formatCode: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
  };
}

// ── buildTools ──────────────────────────────────────────────────────────────

describe("buildTools", () => {
  it("returns exactly 15 tool definitions", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);
    expect(tools).toHaveLength(15);
  });

  it("each tool has the required shape (name, description, inputSchema, handler)", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);
    for (const tool of tools) {
      expect(tool).toHaveProperty("name");
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool).toHaveProperty("description");
      expect(typeof tool.description).toBe("string");

      expect(tool).toHaveProperty("inputSchema");
      expect(tool.inputSchema).toBeTypeOf("object");

      expect(tool).toHaveProperty("handler");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("each inputSchema includes type 'object' and a properties map", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);
    for (const tool of tools) {
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });

  it("returns tools with the expected set of names", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "find_files",
      "find_symbol",
      "format_code",
      "get_diff",
      "get_line_numbers",
      "list_directory",
      "patch_file",
      "read_file",
      "replace_lines",
      "run_command",
      "run_tests",
      "search_codebase",
      "submit_fix",
      "trace_imports",
      "write_file",
    ]);
  });

  it("each tool has a non-empty description", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);
    for (const tool of tools) {
      expect(tool.description.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── dispatchNamedTool ───────────────────────────────────────────────────────

describe("dispatchNamedTool", () => {
  it("dispatches to the correct tool by name", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("file content");
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "read_file", {
      file_path: "/src/test.ts",
    });

    expect(sandbox.readFile).toHaveBeenCalledWith("/src/test.ts");
    expect(result).toBe("file content");
  });

  it("dispatches write_file tool correctly", async () => {
    const sandbox = createMockSandbox();
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "/out.txt",
      content: "data",
    });

    expect(sandbox.writeFile).toHaveBeenCalledWith("/out.txt", "data");
    expect(result).toContain("Successfully wrote");
  });

  it("returns an error for an unknown tool name", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "fly_to_moon", {});

    expect(result).toContain("Error: unknown tool 'fly_to_moon'");
  });

  it("error message lists available tools for unknown name", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "nope", {});

    expect(result).toContain("read_file");
    expect(result).toContain("write_file");
    expect(result).toContain("run_command");
  });
});

// ── toOpenAiTools ───────────────────────────────────────────────────────────

describe("toOpenAiTools", () => {
  it("converts all tools to OpenAI-compatible format", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const openaiTools = toOpenAiTools(tools);

    expect(openaiTools).toHaveLength(15);
    for (const t of openaiTools) {
      expect(t).toHaveProperty("type", "function");
      expect(t.function).toHaveProperty("name");
      expect(typeof t.function.name).toBe("string");
      expect(t.function).toHaveProperty("description");
      expect(t.function).toHaveProperty("parameters");
    }
  });

  it("preserves tool names, descriptions, and input schemas", () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const openaiTools = toOpenAiTools(tools);

    for (let i = 0; i < tools.length; i++) {
      expect(openaiTools[i].function.name).toBe(tools[i].name);
      expect(openaiTools[i].function.description).toBe(tools[i].description);
      expect(openaiTools[i].function.parameters).toBe(
        tools[i].inputSchema,
      );
    }
  });

  it('every OpenAI tool has type "function"', () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const openaiTools = toOpenAiTools(tools);

    for (const t of openaiTools) {
      expect(t.type).toBe("function");
    }
  });
});

// ── read_file tool ──────────────────────────────────────────────────────────

describe("read_file tool", () => {
  it("calls sandbox.readFile with the correct path", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("file content");
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "read_file", {
      file_path: "/src/app.ts",
    });

    expect(sandbox.readFile).toHaveBeenCalledWith("/src/app.ts");
    expect(result).toBe("file content");
  });

  it("returns error for empty file_path", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "read_file", {
      file_path: "",
    });

    expect(result).toBe("Error: file_path is required");
  });

  it("returns error when file_path arg is missing", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "read_file", {});

    expect(result).toBe("Error: file_path is required");
  });

  it("handles sandbox.readFile rejecting with an error", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockRejectedValue(new Error("ENOENT: file not found"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "read_file", {
      file_path: "/missing.ts",
    });

    expect(result).toContain("Error reading file");
    expect(result).toContain("ENOENT");
  });
});

// ── write_file tool ─────────────────────────────────────────────────────────

describe("write_file tool", () => {
  it("calls sandbox.writeFile with the correct path and content", async () => {
    const sandbox = createMockSandbox();
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "/src/out.ts",
      content: "export const x = 1;",
    });

    expect(sandbox.writeFile).toHaveBeenCalledWith(
      "/src/out.ts",
      "export const x = 1;",
    );
    expect(result).toContain("Successfully wrote");
    expect(result).toContain("/src/out.ts");
  });

  it("includes byte count in success message", async () => {
    const sandbox = createMockSandbox();
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "/f.ts",
      content: "abc",
    });

    expect(result).toContain("3 bytes");
  });

  it("returns error for empty file_path", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "",
      content: "data",
    });

    expect(result).toBe("Error: file_path is required");
  });

  it("returns error when file_path is missing", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {});

    expect(result).toBe("Error: file_path is required");
  });

  it("handles sandbox.writeFile rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.writeFile.mockRejectedValue(new Error("Permission denied"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "/protected.ts",
      content: "data",
    });

    expect(result).toContain("Error writing file");
  });

  it("handles very long content", async () => {
    const sandbox = createMockSandbox();
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);
    const longContent = "x".repeat(100_000);

    const result = await dispatchNamedTool(tools, "write_file", {
      file_path: "/big.ts",
      content: longContent,
    });

    expect(sandbox.writeFile).toHaveBeenCalledWith("/big.ts", longContent);
    expect(result).toContain("100000 bytes");
  });
});

// ── patch_file tool ─────────────────────────────────────────────────────────

describe("patch_file tool", () => {
  it("applies a unified diff and writes the patched file", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("line1\nline2\nline3");
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);
    const diff = [
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+modified2",
      " line3",
    ].join("\n");

    const result = await dispatchNamedTool(tools, "patch_file", {
      file_path: "test.ts",
      diff,
    });

    expect(sandbox.readFile).toHaveBeenCalledWith("test.ts");
    expect(sandbox.writeFile).toHaveBeenCalledWith(
      "test.ts",
      "line1\nmodified2\nline3",
    );
    expect(result).toContain("Successfully patched");
  });

  it("returns error for empty file_path or diff", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "patch_file", {
      file_path: "",
      diff: "",
    });

    expect(result).toBe("Error: file_path and diff are required");
  });

  it("returns warning when diff does not change the content", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("line1\nline2\nline3");
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    // A non-hunk diff that falls through to applySimplePatch with no-op lines
    const result = await dispatchNamedTool(tools, "patch_file", {
      file_path: "test.ts",
      diff: "  context line\n+new line (no-op in simple mode)",
    });

    expect(result).toContain(
      "Warning: diff applied but file content did not change",
    );
  });

  it("handles sandbox.readFile or writeFile errors", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockRejectedValue(new Error("File locked"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "patch_file", {
      file_path: "/locked.ts",
      diff: "@@ -1,1 +1,1 @@\n-foo\n+bar",
    });

    expect(result).toContain("Error patching file");
  });
});

// ── replace_lines tool ──────────────────────────────────────────────────────

describe("replace_lines tool", () => {
  it("replaces a range of lines with new content", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("line1\nline2\nline3\nline4");
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "replace_lines", {
      file_path: "/test.ts",
      start_line: 2,
      end_line: 3,
      new_content: "replacement",
    });

    expect(sandbox.readFile).toHaveBeenCalledWith("/test.ts");
    expect(sandbox.writeFile).toHaveBeenCalledWith(
      "/test.ts",
      "line1\nreplacement\nline4",
    );
    expect(result).toBe("Replaced lines 2-3 in /test.ts");
  });

  it("replaces single line when start_line equals end_line", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("a\nb\nc");
    sandbox.writeFile.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "replace_lines", {
      file_path: "/f.ts",
      start_line: 2,
      end_line: 2,
      new_content: "B",
    });

    expect(sandbox.writeFile).toHaveBeenCalledWith("/f.ts", "a\nB\nc");
    expect(result).toContain("Replaced lines 2-2");
  });

  it("returns error for invalid line range", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockResolvedValue("line1\nline2");
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "replace_lines", {
      file_path: "/test.ts",
      start_line: 10,
      end_line: 20,
      new_content: "foo",
    });

    expect(result).toContain("Error: invalid line range");
  });

  it("returns error for missing required args", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    expect(
      await dispatchNamedTool(tools, "replace_lines", {}),
    ).toContain("Error");
    expect(
      await dispatchNamedTool(tools, "replace_lines", {
        file_path: "",
      }),
    ).toContain("Error");
  });

  it("handles sandbox.readFile rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.readFile.mockRejectedValue(new Error("Not found"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "replace_lines", {
      file_path: "/missing.ts",
      start_line: 1,
      end_line: 1,
      new_content: "x",
    });

    expect(result).toContain("Error replacing lines");
  });
});

// ── search_codebase tool ────────────────────────────────────────────────────

describe("search_codebase tool", () => {
  it("builds rg command with pattern and returns results", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "src/test.ts:10:function foo()",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "search_codebase", {
      pattern: "foo",
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("rg"),
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("foo"),
    );
    expect(result).toContain("function foo()");
  });

  it("includes file_pattern and path when provided", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "src/app.ts:5:const x = 1",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    await dispatchNamedTool(tools, "search_codebase", {
      pattern: "const",
      file_pattern: "*.ts",
      path: "src",
    });

    const cmd = sandbox.exec.mock.calls[0][0];
    expect(cmd).toContain("-g '*.ts'");
    expect(cmd).toContain("src");
  });

  it("returns 'No matches found' for exitCode 1 without stderr", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "search_codebase", {
      pattern: "nonexistent",
    });

    expect(result).toBe("No matches found.");
  });

  it("returns search error for non-zero exit code with stderr", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "rg: error: invalid pattern",
      exitCode: 2,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "search_codebase", {
      pattern: "[invalid",
    });

    expect(result).toContain("Search error");
    expect(result).toContain("invalid pattern");
  });

  it("returns error for empty pattern", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "search_codebase", {
      pattern: "",
    });

    expect(result).toBe("Error: pattern is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("Sandbox crashed"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "search_codebase", {
      pattern: "foo",
    });

    expect(result).toContain("Error searching codebase");
  });
});

// ── find_files tool ─────────────────────────────────────────────────────────

describe("find_files tool", () => {
  it("builds find command with the pattern", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "src/test.ts\nsrc/utils.ts",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_files", {
      pattern: "*.ts",
    });

    const cmd = sandbox.exec.mock.calls[0][0];
    expect(cmd).toContain("find . -type f -name");
    expect(cmd).toContain("*.ts");
    expect(result).toContain("src/test.ts");
    expect(result).toContain("src/utils.ts");
  });

  it("returns 'No files found' for empty output", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_files", {
      pattern: "*.zig",
    });

    expect(result).toBe("No files found.");
  });

  it("returns error for empty pattern", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_files", {
      pattern: "",
    });

    expect(result).toBe("Error: pattern is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("find: bad option"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_files", {
      pattern: "*.ts",
    });

    expect(result).toContain("Error finding files");
  });
});

// ── run_command tool ────────────────────────────────────────────────────────

describe("run_command tool", () => {
  it("executes command and formats stdout, stderr, exit code", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "hello world",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {
      command: "echo hello",
    });

    expect(sandbox.exec).toHaveBeenCalledWith("echo hello");
    expect(result).toContain("hello world");
    expect(result).toContain("exit code: 0");
  });

  it("includes stderr in output when present", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "warning: deprecated API",
      exitCode: 1,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {
      command: "lint",
    });

    expect(result).toContain("warning: deprecated API");
    expect(result).toContain("exit code: 1");
  });

  it("returns error for empty command", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {
      command: "",
    });

    expect(result).toBe("Error: command is required");
  });

  it("returns error when command arg is missing", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {});

    expect(result).toBe("Error: command is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("Command timed out"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {
      command: "sleep 100",
    });

    expect(result).toContain("Error running command");
  });

  it("truncates long stdout to 10000 chars", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "x".repeat(20_000),
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_command", {
      command: "generate-output",
    });

    expect(result.length).toBeLessThanOrEqual(11000); // stdout 10000 + some overhead
  });
});

// ── run_tests tool ──────────────────────────────────────────────────────────

describe("run_tests tool", () => {
  it("calls sandbox.runTests and formats passing output", async () => {
    const sandbox = createMockSandbox();
    sandbox.runTests.mockResolvedValue({
      passed: true,
      output: "All tests passed!",
      command: "vitest run",
      durationMs: 1500,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_tests", {});

    expect(sandbox.runTests).toHaveBeenCalled();
    expect(result).toContain("PASSED");
    expect(result).toContain("vitest run");
    expect(result).toContain("1500ms");
    expect(result).toContain("All tests passed!");
  });

  it("formats failing output correctly", async () => {
    const sandbox = createMockSandbox();
    sandbox.runTests.mockResolvedValue({
      passed: false,
      output: "1 test failed\n  ✗ foo.test.ts",
      command: "vitest run",
      durationMs: 500,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_tests", {});

    expect(result).toContain("FAILED");
    expect(result).toContain("foo.test.ts");
  });

  it("handles sandbox.runTests rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.runTests.mockRejectedValue(new Error("Test runner crashed"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "run_tests", {});

    expect(result).toContain("Error running tests");
  });
});

// ── submit_fix tool ─────────────────────────────────────────────────────────

describe("submit_fix tool", () => {
  it("calls sandbox.pushBranch and returns success message", async () => {
    const sandbox = createMockSandbox();
    sandbox.pushBranch.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "submit_fix", {
      branch_name: "fix/issue-42",
    });

    expect(sandbox.pushBranch).toHaveBeenCalledWith("fix/issue-42");
    expect(result).toContain("fix/issue-42");
    expect(result).toContain("PR can now be created");
  });

  it("uses default commit message when not provided", async () => {
    const sandbox = createMockSandbox();
    sandbox.pushBranch.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    await dispatchNamedTool(tools, "submit_fix", {
      branch_name: "fix/test",
    });

    expect(sandbox.pushBranch).toHaveBeenCalledWith("fix/test");
  });

  it("returns error for empty branch_name", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "submit_fix", {
      branch_name: "",
    });

    expect(result).toBe("Error: branch_name is required");
  });

  it("handles sandbox.pushBranch rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.pushBranch.mockRejectedValue(new Error("Git push failed"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "submit_fix", {
      branch_name: "fix/bad",
    });

    expect(result).toContain("Error submitting fix");
  });
});

// ── get_diff tool ───────────────────────────────────────────────────────────

describe("get_diff tool", () => {
  it("executes git diff and returns output", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "diff --git a/test.ts b/test.ts\nindex abc..def 100644\n--- a/test.ts\n+++ b/test.ts",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "get_diff", {});

    expect(sandbox.exec).toHaveBeenCalledWith("git diff .");
    expect(result).toContain("diff --git");
  });

  it("restricts diff to provided path", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const tools = buildTools(sandbox);

    await dispatchNamedTool(tools, "get_diff", { path: "src/" });

    expect(sandbox.exec).toHaveBeenCalledWith("git diff src/");
  });

  it('returns "No uncommitted changes" for empty diff', async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "get_diff", {});

    expect(result).toBe("No uncommitted changes.");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("Not a git repo"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "get_diff", {});

    expect(result).toContain("Error getting diff");
  });
});

// ── format_code tool ────────────────────────────────────────────────────────

describe("format_code tool", () => {
  it("calls sandbox.formatCode and returns success", async () => {
    const sandbox = createMockSandbox();
    sandbox.formatCode.mockResolvedValue(undefined);
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "format_code", {});

    expect(sandbox.formatCode).toHaveBeenCalled();
    expect(result).toBe("Code formatted successfully.");
  });

  it("handles sandbox.formatCode rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.formatCode.mockRejectedValue(new Error("Formatter not found"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "format_code", {});

    expect(result).toContain("Error formatting code");
  });
});

// ── list_directory tool ─────────────────────────────────────────────────────

describe("list_directory tool", () => {
  it("lists directory with find command at default depth", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "src\nsrc/test.ts\nsrc/utils",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "list_directory", {
      path: "src",
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("find src"),
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("-maxdepth 1"),
    );
    expect(result).toContain("src/test.ts");
  });

  it("accepts custom depth parameter", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    await dispatchNamedTool(tools, "list_directory", {
      path: ".",
      depth: 3,
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("-maxdepth 3"),
    );
  });

  it("returns error for empty path", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "list_directory", {
      path: "",
    });

    expect(result).toBe("Error: path is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("Permission denied"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "list_directory", {
      path: "/root",
    });

    expect(result).toContain("Error listing directory");
  });
});

// ── get_line_numbers tool ───────────────────────────────────────────────────

describe("get_line_numbers tool", () => {
  it("searches file with grep and returns matches", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "5:function foo()\n12:  foo()",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "get_line_numbers", {
      file_path: "src/test.ts",
      pattern: "function",
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("grep"),
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("src/test.ts"),
    );
    expect(result).toContain("function foo()");
  });

  it("includes context lines when context is provided", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValue({
      stdout: "4-const x = 1\n5:function foo()\n6-const y = 2",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    await dispatchNamedTool(tools, "get_line_numbers", {
      file_path: "src/test.ts",
      pattern: "function",
      context: 1,
    });

    const cmd = sandbox.exec.mock.calls[0][0];
    expect(cmd).toContain("-C 1");
  });

  it("returns error for missing file_path or pattern", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    expect(
      await dispatchNamedTool(tools, "get_line_numbers", {}),
    ).toBe("Error: file_path and pattern are required");
    expect(
      await dispatchNamedTool(tools, "get_line_numbers", {
        file_path: "",
        pattern: "",
      }),
    ).toBe("Error: file_path and pattern are required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("grep: No such file"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "get_line_numbers", {
      file_path: "/missing.ts",
      pattern: "foo",
    });

    expect(result).toContain("Error searching file");
  });
});

// ── find_symbol tool ────────────────────────────────────────────────────────

describe("find_symbol tool", () => {
  it("searches for symbol using rg and returns results", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValueOnce({
      stdout: "src/test.ts:5:export function foo()",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_symbol", {
      symbol: "foo",
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("rg"),
    );
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining("foo"),
    );
    expect(result).toContain("ripgrep results");
    expect(result).toContain("export function foo()");
  });

  it("falls back to grep when rg returns no results", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "src/bar.ts:3:const bar = 1",
        stderr: "",
        exitCode: 0,
      });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_symbol", {
      symbol: "bar",
    });

    expect(result).toContain("grep results");
    expect(result).toContain("const bar = 1");
  });

  it("returns no-usages message when both searches find nothing", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_symbol", {
      symbol: "never_used",
    });

    expect(result).toContain("No usages of 'never_used' found");
  });

  it("returns error for empty symbol", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_symbol", {
      symbol: "",
    });

    expect(result).toBe("Error: symbol is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("rg not found"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "find_symbol", {
      symbol: "foo",
    });

    expect(result).toContain("Error finding symbol");
  });
});

// ── trace_imports tool ──────────────────────────────────────────────────────

describe("trace_imports tool", () => {
  it("traces imports and returns the dependency chain", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec
      .mockResolvedValueOnce({
        stdout: "import { foo } from './bar'",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "import { baz } from './qux'",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "trace_imports", {
      file_path: "src/index.ts",
    });

    expect(result).toContain("src/index.ts");
    expect(result).toContain("./bar");
    expect(result).toContain("./qux");
  });

  it("stops early when no more imports are found", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "trace_imports", {
      file_path: "src/leaf.ts",
    });

    expect(result).toBe("src/leaf.ts");
  });

  it("returns error for empty file_path", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "trace_imports", {
      file_path: "",
    });

    expect(result).toBe("Error: file_path is required");
  });

  it("handles sandbox.exec rejecting", async () => {
    const sandbox = createMockSandbox();
    sandbox.exec.mockRejectedValue(new Error("grep: No such file"));
    const tools = buildTools(sandbox);

    const result = await dispatchNamedTool(tools, "trace_imports", {
      file_path: "src/missing.ts",
    });

    expect(result).toContain("Error tracing imports");
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases across all tools", () => {
  it("missing args produce clear error messages for required-arg tools", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    const errorTests = [
      ["read_file", {}],
      ["write_file", {}],
      ["patch_file", {}],
      ["search_codebase", {}],
      ["find_files", {}],
      ["run_command", {}],
      ["list_directory", {}],
      ["get_line_numbers", {}],
      ["find_symbol", {}],
      ["trace_imports", {}],
      ["submit_fix", {}],
    ];

    for (const [name, args] of errorTests) {
      const result = await dispatchNamedTool(tools, name as string, args as Record<string, unknown>);
      expect(result).toContain("Error");
    }
  });

  it("tools that accept empty args still handle gracefully", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    // These tools have no required args and should not crash
    const noCrashTests = ["run_tests", "format_code", "get_diff"];

    for (const name of noCrashTests) {
      const result = await dispatchNamedTool(tools, name, {});
      // Should return a string (not throw)
      expect(typeof result).toBe("string");
    }
  });

  it("all tool handlers wrap sandbox errors and return string messages", async () => {
    const sandbox = createMockSandbox();
    const tools = buildTools(sandbox);

    // Make all sandbox methods reject
    sandbox.readFile.mockRejectedValue(new Error("fail"));
    sandbox.writeFile.mockRejectedValue(new Error("fail"));
    sandbox.exec.mockRejectedValue(new Error("fail"));
    sandbox.runTests.mockRejectedValue(new Error("fail"));
    sandbox.formatCode.mockRejectedValue(new Error("fail"));
    sandbox.pushBranch.mockRejectedValue(new Error("fail"));

    const errorCases = [
      ["read_file", { file_path: "/x.ts" }],
      ["write_file", { file_path: "/x.ts", content: "x" }],
      ["patch_file", { file_path: "/x.ts", diff: "@@ -1,1 +1,1 @@\n-foo\n+bar" }],
      ["replace_lines", { file_path: "/x.ts", start_line: 1, end_line: 1, new_content: "x" }],
      ["search_codebase", { pattern: "x" }],
      ["find_files", { pattern: "*.ts" }],
      ["run_command", { command: "ls" }],
      ["run_tests", {}],
      ["get_diff", {}],
      ["format_code", {}],
      ["list_directory", { path: "/x" }],
      ["get_line_numbers", { file_path: "/x.ts", pattern: "x" }],
      ["find_symbol", { symbol: "x" }],
      ["trace_imports", { file_path: "/x.ts" }],
      ["submit_fix", { branch_name: "fix/x" }],
    ];

    for (const [name, args] of errorCases) {
      const result = await dispatchNamedTool(tools, name as string, args as Record<string, unknown>);
      expect(typeof result).toBe("string");
      // Error message should be informative (contains "Error")
      expect(result).toContain("Error");
    }
  });
});
