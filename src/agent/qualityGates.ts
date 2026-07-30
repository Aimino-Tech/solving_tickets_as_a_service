/**
 * qualityGates.ts — Quality gate result types for agent pipeline gates.
 *
 * These types are used by the agent's verification gates (buildTestGate,
 * realityCheck, compileCheck, etc.) and are designed to be compatible with
 * the GateResult type used across the agent pipeline.
 */

export interface GateResult {
  gate: string;
  passed: boolean;
  duration: number;
  reason: string;
  details?: string;
}
