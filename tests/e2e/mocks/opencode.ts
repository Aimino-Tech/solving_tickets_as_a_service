/**
 * Mock OpenCode serve endpoint for E2E tests.
 *
 * Spins up a lightweight Express server that simulates the OpenCode serve
 * API. Returns controlled responses for agent runs so E2E tests don't
 * need a real OpenCode instance.
 *
 * Usage:
 * ```ts
 * import { createMockOpenCodeServer } from '../mocks/opencode.js';
 * const openCode = createMockOpenCodeServer();
 * await openCode.start();
 *
 * // Inspect what was sent to OpenCode
 * expect(openCode.receivedRequests).toHaveLength(1);
 *
 * await openCode.stop();
 * ```
 */

export {
  createMockOpenCodeServer,
} from '../harness/index.js';

export type { MockOpenCodeServer } from '../harness/index.js';
