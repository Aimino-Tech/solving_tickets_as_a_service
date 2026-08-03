/**
 * SUT (system under test) abstraction for the continuity harness (AIM-4445).
 *
 * A ChatSUT is anything that answers a user message within a single
 * conversation. Two deterministic mocks ship with the harness:
 *
 *   - ScriptedMemorySUT: replies from the scenario fixture - simulates a
 *     memory-ful agent, proving the harness + detector logic is correct.
 *   - GoldfishSUT: always asks for re-explanation - the no-memory baseline
 *     that MUST fail the harness.
 *
 * The real SUT (an opencode-serve conversation behind the SYNTARO gateway) is
 * wired later by injecting a client that implements ChatSUT; the harness
 * itself never depends on @opencode-ai/sdk.
 */
import type { ContinuityScenario } from '../fixtures/continuity-scenarios.js';

export interface ChatSUT {
  /** Human-readable name used in reports. */
  readonly name: string;
  /** Send one user message and await the assistant reply. */
  ask(message: string): Promise<string>;
  /** Simulate pod death (kill -9). Caller decides when; SUT decides semantics. */
  kill(): Promise<void>;
  /** Start a fresh conversation (used between runs). */
  reset(): Promise<void>;
}

/** Answers from the scenario's scripted replies - a perfect-memory agent. */
export class ScriptedMemorySUT implements ChatSUT {
  readonly name: string;

  private readonly scenario: ContinuityScenario;
  private turnIndex = 0;

  constructor(scenario: ContinuityScenario) {
    this.scenario = scenario;
    this.name = `scripted-memory:${scenario.id}`;
  }

  async ask(_message: string): Promise<string> {
    if (this.turnIndex >= this.scenario.turns.length) {
      throw new Error(`ScriptedMemorySUT: no scripted reply for turn ${this.turnIndex + 1}`);
    }
    const reply = this.scenario.turns[this.turnIndex]!.scriptedReply;
    this.turnIndex += 1;
    return reply;
  }

  async kill(): Promise<void> {
    // A scripted agent has no mutable memory to lose; kill is a no-op.
  }

  async reset(): Promise<void> {
    this.turnIndex = 0;
  }
}

/** Always asks the user to re-explain - the no-memory baseline. */
export class GoldfishSUT implements ChatSUT {
  readonly name = 'goldfish';

  async ask(_message: string): Promise<string> {
    return 'Sorry, I lost the context. Could you explain from the start again?';
  }

  async kill(): Promise<void> {}

  async reset(): Promise<void> {}
}
