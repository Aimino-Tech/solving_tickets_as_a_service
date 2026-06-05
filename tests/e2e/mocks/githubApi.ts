/**
 * Mock GitHub API server for E2E tests.
 *
 * Handles:
 *   - POST /repos/:owner/:repo/issues/:number/comments
 *   - POST /repos/:owner/:repo/pulls
 *   - GET /repos/:owner/:repo/issues/:number
 *
 * Returns predictable responses that the STAS worker expects.
 */

import { createServer, type AddressInfo } from "node:net";
import http from "node:http";

export interface MockGitHubApiOptions {
  /** If true, PR creation will fail (for testing error paths) */
  failPrCreation?: boolean;
  /** If true, comment creation will fail */
  failCommentCreation?: boolean;
}

export interface MockGitHubApiInstance {
  server: http.Server;
  port: number;
  url: string;
  /** Access recorded requests for assertions */
  requests: Array<{ method: string; url: string; body: unknown }>;
  /** Reset recorded requests */
  reset(): void;
  /** Close the server */
  close(): Promise<void>;
}

/**
 * Create a mock GitHub API server.
 * Returns a fully started server with a dynamically assigned port.
 */
export function createMockGitHubApi(
  options: MockGitHubApiOptions = {},
): Promise<MockGitHubApiInstance> {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  let port = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

      // Record the request
      requests.push({ method: req.method ?? "GET", url: req.url ?? "", body });

      // Route matching
      const urlPath = req.url ?? "";

      if (req.method === "POST" && /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(urlPath)) {
        if (options.failCommentCreation) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Comment creation failed" }));
          return;
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: Date.now(), body: body?.body ?? "" }));
        return;
      }

      if (req.method === "POST" && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(urlPath)) {
        if (options.failPrCreation) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "PR creation failed" }));
          return;
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: 1,
            number: 42,
            html_url: `https://github.com/${body?.head ?? "owner/repo"}/pull/42`,
            title: body?.title ?? "",
          }),
        );
        return;
      }

      if (req.method === "GET" && /^\/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(urlPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: 1,
            number: 42,
            title: "Test Issue",
            body: "Test body",
            state: "open",
            labels: [{ name: "stas:fix" }],
          }),
        );
        return;
      }

      // Fallback — 404
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
