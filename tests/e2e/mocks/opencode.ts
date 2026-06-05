/**
 * Mock OpenCode serve endpoint for E2E tests.
 *
 * Handles:
 *   - POST /api/run — accepts fix requests and returns mock fix results
 *
 * Returns predictable AgentResult-like responses.
 */

import http from "node:http";
import { type AddressInfo } from "node:net";

export interface MockOpenCodeOptions {
  /** If true, the agent will return a failure response */
  failFix?: boolean;
  /** If true, the server will return 500 on every request */
  serverError?: boolean;
  /** Custom response to return */
  customResponse?: Record<string, unknown>;
}

export interface MockOpenCodeInstance {
  server: http.Server;
  port: number;
  url: string;
  /** Access recorded requests for assertions */
  requests: Array<{ body: unknown }>;
  /** Reset recorded requests */
  reset(): void;
  /** Close the server */
  close(): Promise<void>;
}

/**
 * Create a mock OpenCode serve server.
 */
export function createMockOpenCode(
  options: MockOpenCodeOptions = {},
): Promise<MockOpenCodeInstance> {
  const requests: Array<{ body: unknown }> = [];
  let port = 0;

  const defaultSuccessResponse = {
    summary: "Fixed the issue. Applied proper input sanitization.",
    confidence: "high",
    branch: "stas/fix-42-abc123",
    diff: 'diff --git a/src/handler.ts b/src/handler.ts\nindex abc..def 100644\n--- a/src/handler.ts\n+++ b/src/handler.ts\n@@ -10,3 +10,5 @@\n+  // Added sanitization\n+  const sanitized = sanitizeInput(input);',
    testOutput: "PASS tests/handler.test.ts (42ms)\n  ✓ handles special characters\n\nTests: 1 passed, 1 total",
    errors: [],
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      requests.push({ body });

      const urlPath = req.url ?? "";

      if (req.method === "POST" && (urlPath === "/api/run" || urlPath === "/")) {
        // Set CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");

        if (options.serverError) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Internal server error" }));
          return;
        }

        if (options.failFix) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              summary: "Could not reproduce the issue. The code already handles this case.",
              confidence: "low",
              errors: ["Unable to reproduce the issue on latest main"],
              branch: undefined,
              diff: undefined,
              testOutput: undefined,
            }),
          );
          return;
        }

        const response = options.customResponse ?? defaultSuccessResponse;
        res.writeHead(200);
        res.end(JSON.stringify(response));
        return;
      }

      // Health check
      if (req.method === "GET" && urlPath === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        requests,
        reset() {
          requests.length = 0;
        },
        close() {
          return new Promise((resolveClose) => {
            server.close(() => resolveClose());
          });
        },
      });
    });
  });
}
