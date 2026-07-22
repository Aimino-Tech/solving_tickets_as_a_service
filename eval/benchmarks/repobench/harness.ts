import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

interface RepoBenchTask {
  taskId: string;
  repo: string;
  filePath: string;
  question: string;
  expectedAnswer: string;
  contextHints: string[];
}

interface RepoBenchConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  taskLimit: number;
  useLocalRepo: boolean;
}

interface RepoBenchResult {
  taskId: string;
  correct: boolean;
  answerAccuracy: number;
  output: string;
  reasoning: string;
  error: string | null;
  durationMs: number;
  costUsd: number;
}

interface RepoBenchReport {
  benchmark: "repobench";
  runId: string;
  timestamp: string;
  commit: string;
  config: RepoBenchConfig;
  results: {
    total: number;
    correct: number;
    accuracy: number;
    avgTimePerTask: number;
  };
  details: RepoBenchResult[];
}

const TASKS: RepoBenchTask[] = [
  {
    taskId: "repo-001",
    repo: "expressjs/express",
    filePath: "lib/application.js",
    question: "What is the purpose of the `app.use()` function in Express.js? How does it differ from `app.get()` in terms of route matching?",
    expectedAnswer: "app.use() mounts middleware for all HTTP methods, while app.get() matches only GET requests. app.use() matches paths that start with the given path prefix, while app.get() matches exact paths.",
    contextHints: ["Check the route matching logic in lib/router/", "Look at how Layer.match() handles mount paths"],
  },
  {
    taskId: "repo-002",
    repo: "lodash/lodash",
    filePath: "lodash.js",
    question: "Explain the debounce implementation in lodash. How does it handle the leading and trailing options?",
    expectedAnswer: "Lodash debounce uses a closure to track timerId and lastCallTime. With leading=true, the function fires immediately on first call. With trailing=true, it fires after the wait period if calls are still coming. Both can be true to fire on both edges.",
    contextHints: ["Find the internal debounce function", "Look at how invokeFunc is called"],
  },
  {
    taskId: "repo-003",
    repo: "vercel/next.js",
    filePath: "packages/next/server/next-server.ts",
    question: "How does Next.js determine whether to serve a page as static (SSG) or dynamic (SSR)? What internal flags are checked during routing?",
    expectedAnswer: "Next.js checks the render mode from the page manifest. SSG pages have a prerenderManifest entry. SSR pages don't. The isStatic flag is checked in the render function. getStaticProps routes are prerendered at build time.",
    contextHints: ["Check how renderPage works", "Look at prerenderManifest structure"],
  },
  {
    taskId: "repo-004",
    repo: "nestjs/nest",
    filePath: "packages/core/router/router-explorer.ts",
    question: "How does NestJS resolve controller dependencies and register routes? What is the role of the RouterExplorer class?",
    expectedAnswer: "RouterExplorer resolves routes by scanning controller metadata (path, method, parameters). It registers each route handler with the Express/fastify instance. Dependencies are resolved via the Nest injector/DI container before route registration.",
    contextHints: ["Look at how explore() works", "Check the applyCallbackToRouter method"],
  },
  {
    taskId: "repo-005",
    repo: "facebook/react",
    filePath: "packages/react-reconciler/src/ReactFiberWorkLoop.js",
    question: "Explain the work loop in React's reconciler. How does it handle interruption and resumption of rendering?",
    expectedAnswer: "The work loop uses a shouldYield check to interrupt rendering and return control to the browser. Work is tracked via the workInProgress fiber. On interruption, the current fiber tree is preserved and work resumes from the scheduler's next unit of work.",
    contextHints: ["Check the workLoopSync and workLoopConcurrent functions", "Look at how performUnitOfWork advances the fiber"],
  },
];

function scoreAnswer(task: RepoBenchTask, output: string): number {
  const lower = output.toLowerCase();
  const expectedKeywords = task.expectedAnswer.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let matches = 0;
  for (const kw of expectedKeywords) {
    if (lower.includes(kw)) matches++;
  }
  return expectedKeywords.length > 0 ? matches / expectedKeywords.length : 0;
}

function estimateCost(_task: RepoBenchTask, result: RepoBenchResult): number {
  const totalChars = _task.question.length + _task.expectedAnswer.length + result.output.length + (result.reasoning?.length || 0);
  const tokens = totalChars / 3;
  const inputCost = (tokens / 1_000_000) * 3;
  const outputCost = (tokens / 1_000_000) * 15;
  return parseFloat((inputCost + outputCost).toFixed(6));
}

async function evaluateTask(task: RepoBenchTask, config: RepoBenchConfig): Promise<RepoBenchResult> {
  const startTime = Date.now();
  const prompt = `You need to understand the codebase at https://github.com/${task.repo} to answer a question about the file ${task.filePath}.

Question: ${task.question}
Context hints: ${task.contextHints.join(", ")}

First, reason about what parts of the codebase are relevant.
Then, provide your answer based on your understanding of the repository's structure and common patterns in the framework.

Return your response in this format:
Reasoning: <your reasoning about the code>
Answer: <your concise answer>`;

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
          model: config.model,
          messages: [
            { role: "system", content: `You are an expert codebase analyst. You understand large open-source repositories and can answer detailed questions about their architecture, implementation, and design patterns.` },
            { role: "user", content: prompt },
          ],
          temperature: config.temperature,
          max_tokens: config.maxTokens,
        }),
      }
    );
    const data: any = await response.json();
    const content: string = data.choices?.[0]?.message?.content || "";
    const reasoning = content.includes("Reasoning:") ? content.split("Answer:")[0]?.replace("Reasoning:", "").trim() || "" : "";
    const answer = content.includes("Answer:") ? content.split("Answer:")[1]?.trim() || content : content;
    const accuracy = scoreAnswer(task, answer);
    const correct = accuracy >= 0.4;

    const result: RepoBenchResult = {
      taskId: task.taskId,
      correct,
      answerAccuracy: accuracy,
      output: answer.slice(0, 1000),
      reasoning: reasoning.slice(0, 2000),
      error: null,
      durationMs: Date.now() - startTime,
      costUsd: 0,
    };
    result.costUsd = estimateCost(task, result);
    return result;
  } catch (err: any) {
    return {
      taskId: task.taskId,
      correct: false,
      answerAccuracy: 0,
      output: "",
      reasoning: "",
      error: err.message ?? String(err),
      durationMs: Date.now() - startTime,
      costUsd: 0,
    };
  }
}

export async function runRepoBench(config: RepoBenchConfig): Promise<RepoBenchReport> {
  const tasks = TASKS.slice(0, config.taskLimit);
  const details: RepoBenchResult[] = [];

  for (const task of tasks) {
    const result = await evaluateTask(task, config);
    details.push(result);
    console.log(`[${task.taskId}] ${result.correct ? "CORRECT" : "WRONG"} (accuracy: ${(result.answerAccuracy * 100).toFixed(1)}%)`);
  }

  const total = details.length;
  const correct = details.filter((d) => d.correct).length;
  const report: RepoBenchReport = {
    benchmark: "repobench",
    runId: `repobench-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    commit: (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(); } catch { return "unknown"; } })(),
    config,
    results: {
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
      avgTimePerTask: total > 0 ? Math.round(details.reduce((s, d) => s + d.durationMs, 0) / total) : 0,
    },
    details,
  };

  const resultsDir = join(__dirname, "..", "results");
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${Date.now()}-repobench.json`), JSON.stringify(report, null, 2));

  return report;
}
