// STAS Conversation Eval — shared types.
// A "conversation" is a scripted multi-turn dialogue between a User (simulated)
// and the STAS Conversation Agent (real tool calls: GitHub tickets + STAS MCP).

export interface Ticket {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
}

export interface FixResult {
  runId: string;
  status: string;
  pollUrl: string;
}

export type AgentActionType =
  | 'ticket_checked'
  | 'ticket_created'
  | 'fix_submitted'
  | 'status_checked'
  | 'tickets_listed';

export interface AgentAction {
  type: AgentActionType;
  ticketNumber?: number;
  ticketTitle?: string;
  runId?: string;
  status?: string;
}

export interface AgentReply {
  text: string;
  actions: AgentAction[];
  flags: {
    ticketsExisted: number[]; // ticket numbers the agent reported as already existing
    ticketsCreated: number[]; // ticket numbers created this turn
    fixesSubmitted: number; // fixes submitted this turn
    statusChecked: boolean;
    listedCount: number;
  };
}

export type TurnAction =
  | 'fix'
  | 'create'
  | 'check'
  | 'status'
  | 'list';

export interface TurnExpectation {
  action: TurnAction;
  /** expect the agent to report at least one ticket already existing */
  ticketExisted?: boolean;
  /** expect the agent to create at least one ticket this turn */
  ticketCreated?: boolean;
  /** expect the agent to submit at least one fix this turn */
  fixSubmitted?: boolean;
  /** expected minimum number of fixes submitted this turn */
  minFixes?: number;
  /** substrings that must appear in the agent reply */
  replyIncludes?: string[];
  /** substrings that must NOT appear in the agent reply */
  replyExcludes?: string[];
}

export interface ConversationTurn {
  user: string;
  expect: TurnExpectation;
}

export interface ConversationScript {
  id: number;
  name: string;
  repoOwner: string;
  repoName: string;
  turns: ConversationTurn[];
}

export type TurnVerdict = 'pass' | 'fail';

export interface TurnResult {
  index: number;
  user: string;
  reply: string;
  actions: AgentAction[];
  expectation: TurnExpectation;
  verdict: TurnVerdict;
  errors: string[];
}

export interface ConversationResult {
  id: number;
  name: string;
  turns: TurnResult[];
  passed: number;
  failed: number;
}

export interface EvalReport {
  runId: string;
  timestamp: string;
  repo: { owner: string; name: string };
  conversations: ConversationResult[];
  totals: {
    conversations: number;
    turns: number;
    passed: number;
    failed: number;
    passRate: number;
  };
}
