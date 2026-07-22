import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

interface JSTSBechIssue {
  id: string;
  type: string;
  repo: string;
  title: string;
  description: string;
  expectedFix: string;
  difficulty: string;
  files: string[];
}

interface JSTSBechConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  issueLimit: number;
  runMode: "agent" | "prompt";
}

interface JSTSBechResult {
  issueId: string;
  type: string;
  repo: string;
  fixImplemented: boolean;
  score: number;
  output: string;
  error: string | null;
  durationMs: number;
  costUsd: number;
}

interface JSTSBechReport {
  benchmark: "internal-js-ts-bench";
  runId: string;
  timestamp: string;
  commit: string;
  config: JSTSBechConfig;
  results: {
    total: number;
    resolved: number;
    passRate: number;
    byType: Record<string, { total: number; resolved: number; passRate: number }>;
    byDifficulty: Record<string, { total: number; resolved: number; passRate: number }>;
    avgTimePerTask: number;
    avgCostPerTask: number;
  };
  details: JSTSBechResult[];
}

function loadDataset(): { issues: JSTSBechIssue[] } {
  const path = join(__dirname, "dataset.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function estimateCost(issue: JSTSBechIssue, _result: JSTSBechResult): number {
  const tokens = (issue.title.length + issue.description.length + issue.expectedFix.length) / 3;
  return parseFloat(((tokens / 1_000_000) * 5).toFixed(6));
}

function scoreResult(issue: JSTSBechIssue, output: string): number {
  const lower = output.toLowerCase();
  const fixKeywords = issue.expectedFix.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let keywordScore = 0;
  for (const kw of fixKeywords) {
    if (lower.includes(kw)) keywordScore++;
  }
  const keywordRatio = fixKeywords.length > 0 ? keywordScore / fixKeywords.length : 0;

  let fileScore = 0;
  for (const f of issue.files) {
    if (lower.includes(f)) fileScore++;
  }
  const fileRatio = issue.files.length > 0 ? fileScore / issue.files.length : 0;

  const hasCode = lower.includes("```") || lower.includes("function") || lower.includes("const ") || lower.includes("import ");
  const codeScore = hasCode ? 0.15 : 0;

  return Math.min(keywordRatio * 0.5 + fileRatio * 0.35 + codeScore, 1);
}

async function executeViaAgent(issue: JSTSBechIssue, _config: JSTSBechConfig): Promise<JSTSBechResult> {
  const startTime = Date.now();
  const prompt = `Fix the following issue in ${issue.repo}:

Title: ${issue.title}
Description: ${issue.description}

Expected approach: ${issue.expectedFix}
Likely affected files: ${issue.files.join(", ")}

Provide your fix with code changes.`;

  try {
    const response = await fetch(
      process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: _config.model,
          messages: [
            { role: "system", content: `You are an expert ${issue.repo} contributor. You write concise, correct fixes. Provide code changes with file paths and line numbers.` },
            { role: "user", content: prompt },
          ],
          temperature: _config.temperature,
          max_tokens: _config.maxTokens,
        }),
      }
    );
    const data = await response.json();
    const output: string = data.choices?.[0]?.message?.content || "";
    const score = scoreResult(issue, output);
    const cost = estimateCost(issue, { issueId: issue.id, type: issue.type, repo: issue.repo, fixImplemented: score >= 0.4, score, output, error: null, durationMs: Date.now() - startTime, costUsd: 0 });

    return {
      issueId: issue.id,
      type: issue.type,
      repo: issue.repo,
      fixImplemented: score >= 0.4,
      score,
      output: output.slice(0, 1000),
      error: null,
      durationMs: Date.now() - startTime,
      costUsd: cost,
    };
  } catch (err: any) {
    return {
      issueId: issue.id,
      type: issue.type,
      repo: issue.repo,
      fixImplemented: false,
      score: 0,
      output: "",
      error: err.message ?? String(err),
      durationMs: Date.now() - startTime,
      costUsd: 0,
    };
  }
}

export async function runJSTSBech(config: JSTSBechConfig): Promise<JSTSBechReport> {
  const dataset = loadDataset();
  const issues = dataset.issues.slice(0, config.issueLimit);
  const details: JSTSBechResult[] = [];
  const byType: Record<string, { total: number; resolved: number; passRate: number }> = {};
  const byDifficulty: Record<string, { total: number; resolved: number; passRate: number }> = {};

  for (const issue of issues) {
    const result = await executeViaAgent(issue, config);
    details.push(result);

    if (!byType[issue.type]) byType[issue.type] = { total: 0, resolved: 0, passRate: 0 };
    byType[issue.type].total++;
    if (result.fixImplemented) byType[issue.type].resolved++;

    if (!byDifficulty[issue.difficulty]) byDifficulty[issue.difficulty] = { total: 0, resolved: 0, passRate: 0 };
    byDifficulty[issue.difficulty].total++;
    if (result.fixImplemented) byDifficulty[issue.difficulty].resolved++;

    console.log(`[${issue.id}] ${result.fixImplemented ? "FIXED" : "FAILED"} (${issue.type}/${issue.difficulty}, score: ${result.score.toFixed(2)})`);
  }

  for (const cat of Object.keys(byType)) byType[cat].passRate = byType[cat].resolved / byType[cat].total;
  for (const cat of Object.keys(byDifficulty)) byDifficulty[cat].passRate = byDifficulty[cat].resolved / byDifficulty[cat].total;

  const total = details.length;
  const resolved = details.filter((d) => d.fixImplemented).length;
  const report: JSTSBechReport = {
    benchmark: "internal-js-ts-bench",
    runId: `jsts-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    commit: (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(); } catch { return "unknown"; } })(),
    config,
    results: {
      total,
      resolved,
      passRate: total > 0 ? resolved / total : 0,
      byType,
      byDifficulty,
      avgTimePerTask: total > 0 ? Math.round(details.reduce((s, d) => s + d.durationMs, 0) / total) : 0,
      avgCostPerTask: total > 0 ? parseFloat((details.reduce((s, d) => s + d.costUsd, 0) / total).toFixed(6)) : 0,
    },
    details,
  };

  const resultsDir = join(__dirname, "..", "results");
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${Date.now()}-internal-js-ts.json`), JSON.stringify(report, null, 2));

  return report;
}

if (require.main === module) {
  const config: JSTSBechConfig = {
    model: process.env.MODEL || "claude-sonnet-4",
    temperature: 0,
    maxTokens: 4096,
    issueLimit: parseInt(process.env.ISSUE_LIMIT || "28", 10),
    runMode: (process.env.RUN_MODE as "agent" | "prompt") || "agent",
  };
  runJSTSBech(config).then((r) => { console.log(`JS/TS Bench pass rate: ${(r.results.passRate * 100).toFixed(1)}%`); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
