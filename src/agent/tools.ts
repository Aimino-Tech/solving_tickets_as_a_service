/**
 * Tool definitions for the agent loop.
 *
 * Each tool has a name, description, JSON input schema, and a handler function.
 * The tools follow KintsugiBot's pattern and are made available to the main
 * agent loop for code investigation and fix execution.
 */

import type { AgentTool } from "./types.js";

// ── Tool handler type ──────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

// ── Individual tool definitions ────────────────────────────────────

function readFileTool(sandbox: {
  readFile: (path: string) => Promise<string>;
}): AgentTool {
  return {
    name: "read_file",
    description: "Read the contents of a file from the codebase.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or repo-relative path to the file",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read",
        },
      },
      required: ["file_path"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      if (!filePath) return "Error: file_path is required";
      try {
        return await sandbox.readFile(filePath);
      } catch (err) {
        return `Error reading file: ${String(err)}`;
      }
    }
  };
}

function writeFileTool(sandbox: {
  writeFile: (path: string, content: string) => Promise<void>;
}): AgentTool {
  return {
    name: "write_file",
    description: "Write content to a file (creates or overwrites).",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file",
        },
        content: {
          type: "string",
          description: "Full content to write",
        },
      },
      required: ["file_path", "content"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      const content = String(args.content ?? "");
      if (!filePath) return "Error: file_path is required";
      try {
        await sandbox.writeFile(filePath, content);
        return `Successfully wrote ${filePath} (${content.length} bytes)`;
      } catch (err) {
        return `Error writing file: ${String(err)}`;
      }
    }
  };
}

function patchFileTool(sandbox: {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}): AgentTool {
  return {
    name: "patch_file",
    description:
      "Apply a unified diff patch to a file. Uses standard patch format.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to patch",
        },
        diff: {
          type: "string",
          description: "Unified diff content to apply",
        },
      },
      required: ["file_path", "diff"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      const diff = String(args.diff ?? "");
      if (!filePath || !diff) return "Error: file_path and diff are required";
      try {
        const current = await sandbox.readFile(filePath);
        const patched = applyUnifiedDiff(current, diff);
        if (patched === current) {
          return "Warning: diff applied but file content did not change. Check the diff format.";
        }
        await sandbox.writeFile(filePath, patched);
        return `Successfully patched ${filePath}`;
      } catch (err) {
        return `Error patching file: ${String(err)}`;
      }
    }
  };
}

function replaceLinesTool(sandbox: {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}): AgentTool {
  return {
    name: "replace_lines",
    description:
      "Replace a range of lines in a file with new content. Lines are 1-indexed.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file",
        },
        start_line: {
          type: "number",
          description: "Start line number (1-indexed, inclusive)",
        },
        end_line: {
          type: "number",
          description: "End line number (1-indexed, inclusive)",
        },
        new_content: {
          type: "string",
          description: "Replacement content",
        },
      },
      required: ["file_path", "start_line", "end_line", "new_content"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      const startLine = Number(args.start_line ?? 0);
      const endLine = Number(args.end_line ?? 0);
      const newContent = String(args.new_content ?? "");
      if (!filePath || !startLine || !endLine) {
        return "Error: file_path, start_line, and end_line are required";
      }
      try {
        const content = await sandbox.readFile(filePath);
        const lines = content.split("\n");
        if (
          startLine < 1 ||
          endLine > lines.length ||
          startLine > endLine
        ) {
          return `Error: invalid line range. File has ${lines.length} lines, requested ${startLine}-${endLine}.`;
        }
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(endLine);
        const result = [...before, newContent, ...after].join("\n");
        await sandbox.writeFile(filePath, result);
        return `Replaced lines ${startLine}-${endLine} in ${filePath}`;
      } catch (err) {
        return `Error replacing lines: ${String(err)}`;
      }
    }
  };
}

function searchCodebaseTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "search_codebase",
    description:
      "Search the codebase using ripgrep or grep. Patterns are regex by default.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Optional subdirectory to restrict the search to",
        },
        file_pattern: {
          type: "string",
          description: "Optional glob to filter files (e.g. *.ts)",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 50)",
        },
      },
      required: ["pattern"],
    },
    handler: async (args) => {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return "Error: pattern is required";
      const searchPath = args.path ? String(args.path) : ".";
      const filePat = args.file_pattern ? String(args.file_pattern) : "";
      const maxResults = Number(args.max_results ?? 50);

      let cmd = `rg -n --max-count ${maxResults}`;
      if (filePat) cmd += ` -g '${filePat}'`;
      cmd += ` '${pattern.replace(/'/g, "'\\''")}' ${searchPath}`;

      try {
        const result = await sandbox.exec(cmd);
        if (result.exitCode !== 0 && result.stderr) {
          // rg returns 1 when no matches — that's not an error
          if (result.exitCode === 1 && !result.stderr) {
            return "No matches found.";
          }
          return `Search error (exit ${result.exitCode}): ${result.stderr.slice(0, 1000)}`;
        }
        const output = result.stdout.slice(0, 10000);
        if (!output.trim()) return "No matches found.";
        return output;
      } catch (err) {
        return `Error searching codebase: ${String(err)}`;
      }
    }
  };
}

function findFilesTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "find_files",
    description:
      "Find files in the repository matching a glob pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g., **/*.ts, **/test/**)",
        },
        max_results: {
          type: "number",
          description: "Maximum results (default 100)",
        },
      },
      required: ["pattern"],
    },
    handler: async (args) => {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return "Error: pattern is required";
      const maxResults = Number(args.max_results ?? 100);
      try {
        const result = await sandbox.exec(
          `find . -type f -name '${pattern.replace(/'/g, "'\\''")}' 2>/dev/null | head -${maxResults}`,
        );
        const output = result.stdout.slice(0, 5000);
        if (!output.trim()) return "No files found.";
        return output;
      } catch (err) {
        return `Error finding files: ${String(err)}`;
      }
    }
  };
}

function runCommandTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "run_command",
    description:
      "Run an arbitrary shell command in the sandbox. Use for building, linting, or any CLI operation.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 60000)",
        },
        workdir: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["command"],
    },
    handler: async (args) => {
      const command = String(args.command ?? "");
      if (!command) return "Error: command is required";
      try {
        const result = await sandbox.exec(command);
        const stdout = result.stdout.slice(0, 10000);
        const stderr = result.stderr.slice(0, 5000);
        const parts: string[] = [];
        if (stdout) parts.push(`stdout:\n${stdout}`);
        if (stderr) parts.push(`stderr:\n${stderr}`);
        parts.push(`exit code: ${result.exitCode}`);
        return parts.join("\n\n");
      } catch (err) {
        return `Error running command: ${String(err)}`;
      }
    }
  };
}

function runTestsTool(sandbox: {
  runTests: () => Promise<{
    passed: boolean;
    output: string;
    command: string;
    durationMs: number;
  }>;
}): AgentTool {
  return {
    name: "run_tests",
    description:
      "Run the project's test suite and return results.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      try {
        const result = await sandbox.runTests();
        const output = result.output.slice(0, 10000);
        return [
          `Tests ${result.passed ? "✅ PASSED" : "❌ FAILED"}`,
          `Command: ${result.command}`,
          `Duration: ${result.durationMs}ms`,
          "",
          output,
        ].join("\n");
      } catch (err) {
        return `Error running tests: ${String(err)}`;
      }
    }
  };
}

function getDiffTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "get_diff",
    description:
      "Get the current working tree diff (uncommitted changes).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional file path to restrict the diff to",
        },
      },
    },
    handler: async (args) => {
      const path = args.path ? String(args.path) : ".";
      try {
        const result = await sandbox.exec(`git diff ${path}`);
        return result.stdout.slice(0, 10000) || "No uncommitted changes.";
      } catch (err) {
        return `Error getting diff: ${String(err)}`;
      }
    }
  };
}

function formatCodeTool(sandbox: {
  formatCode: () => Promise<void>;
}): AgentTool {
  return {
    name: "format_code",
    description:
      "Auto-format all modified files in the repository.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      try {
        await sandbox.formatCode();
        return "Code formatted successfully.";
      } catch (err) {
        return `Error formatting code: ${String(err)}`;
      }
    }
  };
}

function listDirectoryTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "list_directory",
    description:
      "List files and directories at a given path.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list",
        },
        depth: {
          type: "number",
          description: "Maximum depth (default 1)",
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const dirPath = String(args.path ?? "");
      const depth = Number(args.depth ?? 1);
      if (!dirPath) return "Error: path is required";
      try {
        const result = await sandbox.exec(
          `find ${dirPath} -maxdepth ${depth} 2>/dev/null | head -200`,
        );
        return result.stdout.slice(0, 5000) || "Directory is empty or does not exist.";
      } catch (err) {
        return `Error listing directory: ${String(err)}`;
      }
    }
  };
}

function getLineNumbersTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "get_line_numbers",
    description:
      "Get line numbers matching a pattern in a file.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file",
        },
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        context: {
          type: "number",
          description: "Lines of context around matches (default 0)",
        },
      },
      required: ["file_path", "pattern"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      const pattern = String(args.pattern ?? "");
      const context = Number(args.context ?? 0);
      if (!filePath || !pattern) return "Error: file_path and pattern are required";
      try {
        const ctxFlag = context > 0 ? ` -C ${context}` : "";
        const result = await sandbox.exec(
          `grep -n${ctxFlag} '${pattern.replace(/'/g, "'\\''")}' ${filePath} 2>/dev/null | head -100`,
        );
        return result.stdout.slice(0, 5000) || "No matches found.";
      } catch (err) {
        return `Error searching file: ${String(err)}`;
      }
    }
  };
}

function findSymbolTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "find_symbol",
    description:
      "Find definitions and usages of a symbol across the codebase.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Symbol name to search for",
        },
        symbol_type: {
          type: "string",
          description:
            "Optional: 'function', 'class', 'variable', 'interface', 'type'",
        },
      },
      required: ["symbol"],
    },
    handler: async (args) => {
      const symbol = String(args.symbol ?? "");
      if (!symbol) return "Error: symbol is required";
      try {
        // Try multiple search strategies
        const rgResult = await sandbox.exec(
          `rg -n "\\b${symbol}\\b" --type ts --type js --type py --type rs --type go 2>/dev/null | head -50`,
        );
        const ctagsResult = await sandbox.exec(
          `grep -rn "\\b${symbol}\\b" src/ 2>/dev/null | head -50`,
        );
        const output = [
          rgResult.stdout ? `## ripgrep results:\n${rgResult.stdout.slice(0, 5000)}` : "",
          ctagsResult.stdout && !rgResult.stdout
            ? `## grep results:\n${ctagsResult.stdout.slice(0, 5000)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        return output || `No usages of '${symbol}' found.`;
      } catch (err) {
        return `Error finding symbol: ${String(err)}`;
      }
    }
  };
}

function traceImportsTool(sandbox: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): AgentTool {
  return {
    name: "trace_imports",
    description:
      "Trace the import chain of a module to understand dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the entry module",
        },
        depth: {
          type: "number",
          description: "Maximum depth to trace (default 3)",
        },
      },
      required: ["file_path"],
    },
    handler: async (args) => {
      const filePath = String(args.file_path ?? "");
      const depth = Number(args.depth ?? 3);
      if (!filePath) return "Error: file_path is required";
      try {
        // Simple import tracing using grep for import/require statements
        let current = filePath;
        const trace: string[] = [`${filePath}`];
        for (let i = 0; i < depth; i++) {
          const imports = await sandbox.exec(
            `grep -E "^(import|const .* require)" ${current} 2>/dev/null | head -20`,
          );
          if (!imports.stdout.trim()) break;
          const lines = imports.stdout.split("\n").filter(Boolean);
          for (const line of lines.slice(0, 5)) {
            trace.push(`  ${"  ".repeat(i)}↳ ${line.trim()}`);
          }
          // Follow first local import
          const localMatch = imports.stdout.match(/['"](\.[^'"]+)['"]/);
          if (localMatch) {
            current = localMatch[1];
          } else {
            break;
          }
        }
        return trace.join("\n");
      } catch (err) {
        return `Error tracing imports: ${String(err)}`;
      }
    }
  };
}

function submitFixTool(sandbox: {
  pushBranch: (branchName: string) => Promise<void>;
}): AgentTool {
  return {
    name: "submit_fix",
    description:
      "Commit all changes and push to a new branch. Call this when the fix is complete.",
    inputSchema: {
      type: "object",
      properties: {
        branch_name: {
          type: "string",
          description: "Name of the branch to create",
        },
        commit_message: {
          type: "string",
          description: "Commit message (default: 'fix: automated fix')",
        },
      },
      required: ["branch_name"],
    },
    handler: async (args) => {
      const branchName = String(args.branch_name ?? "");
      const commitMessage = String(args.commit_message ?? "fix: automated fix");
      if (!branchName) return "Error: branch_name is required";
      try {
        await sandbox.pushBranch(branchName);
        return `Changes committed and pushed to branch '${branchName}'. PR can now be created.`;
      } catch (err) {
        return `Error submitting fix: ${String(err)}`;
      }
    }
  };
}

// ── Builder ────────────────────────────────────────────────────────

export type SandboxTools = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exec: (
    cmd: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  runTests: () => Promise<{
    passed: boolean;
    output: string;
    command: string;
    durationMs: number;
  }>;
  formatCode: () => Promise<void>;
  pushBranch: (branchName: string) => Promise<void>;
};

/**
 * Build the full tool list for the agent loop.
 */
export function buildTools(sandbox: SandboxTools): AgentTool[] {
  return [
    readFileTool(sandbox),
    writeFileTool(sandbox),
    patchFileTool(sandbox),
    replaceLinesTool(sandbox),
    searchCodebaseTool(sandbox),
    findFilesTool(sandbox),
    runCommandTool(sandbox),
    runTestsTool(sandbox),
    getDiffTool(sandbox),
    formatCodeTool(sandbox),
    listDirectoryTool(sandbox),
    getLineNumbersTool(sandbox),
    findSymbolTool(sandbox),
    traceImportsTool(sandbox),
    submitFixTool(sandbox),
  ];
}

/**
 * Dispatch a named tool call to the correct handler.
 */
export async function dispatchNamedTool(
  tools: AgentTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Error: unknown tool '${name}'. Available tools: ${tools.map((t) => t.name).join(", ")}`;
  return tool.handler(args);
}

/**
 * Convert tools to OpenAI-compatible tool format for the cheap model calls.
 */
export function toOpenAiTools(
  tools: AgentTool[],
): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

// ── Simple unified diff applicator ──────────────────────────────────

function applyUnifiedDiff(original: string, diff: string): string {
  // Parse simple unified diffs (hunk-based)
  const lines = original.split("\n");
  const diffLines = diff.split("\n");

  // Find the hunk header: @@ -start,count +start,count @@
  const hunkMatch = diff.match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!hunkMatch) {
    // Fallback: try simple line-based patching
    return applySimplePatch(lines, diffLines);
  }

  const origStart = parseInt(hunkMatch[1], 10);
  const newStart = parseInt(hunkMatch[3], 10);

  // Find the hunk content (lines after @@ header)
  const hunkHeaderIndex = diffLines.findIndex((l) => l.startsWith("@@"));
  if (hunkHeaderIndex === -1) return original;

  const hunkContent = diffLines.slice(hunkHeaderIndex + 1);

  const before = lines.slice(0, origStart - 1);
  const after = lines.slice(origStart - 1);

  let idx = 0;
  const patchedLines: string[] = [];
  let consumed = 0;

  for (const hline of hunkContent) {
    if (hline.startsWith(" ")) {
      // Context line — keep original
      patchedLines.push(after[idx]);
      idx++;
      consumed++;
    } else if (hline.startsWith("-")) {
      // Removal — skip original line
      idx++;
    } else if (hline.startsWith("+")) {
      // Addition — add new line
      patchedLines.push(hline.slice(1));
    }
  }

  const remaining = after.slice(idx);

  return [...before, ...patchedLines, ...remaining].join("\n");
}

function applySimplePatch(
  lines: string[],
  diffLines: string[],
): string {
  // Very simple "replace what matches" approach
  let result = lines.join("\n");

  for (const dline of diffLines) {
    if (dline.startsWith("- ") || dline.startsWith("---")) {
      // Remove line: find and remove
      const search = dline.startsWith("- ") ? dline.slice(2) : dline.slice(4);
      if (search) {
        result = result.replace(search, "");
      }
    } else if (dline.startsWith("+ ")) {
      // Add line: no-op in simple mode
      // Full diff application is better handled via replace_lines or write_file
    }
  }

  return result;
}
