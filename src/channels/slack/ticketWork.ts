/**
 * Ticket-aware work routing for the Slack @syntaro mention handler.
 *
 * AIM-4460: "fix [AIM-1234](...)" → confirm the ticket exists in Linear,
 * dispatch work through the chat bridge, and reply per-ticket with evidence
 * (or "does not exist" when the ticket is missing).
 */

import { ChatLeadBridge } from '../../chat/bridge.js';
import { emptyMemory } from '../../chat/memory.js';
import { rootLogger } from '../../utils/logger.js';
import { createLinearTicketConfirmer, type LinearTicketInfo, type TicketConfirmer } from './ticketConfirm.js';
import { extractTicketRefs } from './ticketRefs.js';
import { truncateForSlack } from './truncate.js';

const log = rootLogger.child({ module: 'slack-ticket-work' });

/** Thread location the reply should land in. */
export interface TicketWorkThreadRef {
  threadTs: string;
  channelId: string;
}

/** Executes one ticket's work instruction and returns evidence text. */
export type TicketWorkRunner = (input: {
  instruction: string;
  threadRef: TicketWorkThreadRef;
  userId: string;
}) => Promise<string>;

/** Request accepted by {@link handleTicketWorkRequest}. */
export interface TicketWorkRequest {
  text: string;
  threadTs: string;
  channelId: string;
  userId: string;
  say: (msg: Record<string, unknown>) => Promise<void>;
  /** Injectable for tests; defaults to the real Linear confirmer. */
  confirmer?: TicketConfirmer;
  /** Injectable for tests; defaults to the chat-bridge runner. */
  runWork?: TicketWorkRunner;
}

/** Options for {@link createLeadSessionRunner}. */
export interface LeadSessionRunnerOptions {
  /** How long to wait for the lead session answer before falling back. */
  waitMs?: number;
  /** Injectable bridge for tests. */
  bridge?: ChatLeadBridge;
}

/**
 * Builds the work instruction a lead session should execute for a ticket.
 *
 * Mirrors the Elixir gateway's `Implement ticket AIM-4450 ...` instruction
 * shape, including the description when present.
 */
export function buildTicketInstruction(ticket: LinearTicketInfo): string {
  let instruction = `Implement ticket ${ticket.identifier}: ${ticket.title}`;
  if (ticket.description) {
    instruction += `\n\n${ticket.description}`;
  }
  return instruction;
}

/**
 * Creates the default {@link TicketWorkRunner}: hands the instruction to a
 * ChatLeadBridge and collects the first matching answer, falling back to a
 * graceful acknowledgment when no answer arrives within `waitMs`.
 */
export function createLeadSessionRunner(opts: LeadSessionRunnerOptions = {}): TicketWorkRunner {
  const waitMs = opts.waitMs ?? 30_000;
  const bridge = opts.bridge ?? new ChatLeadBridge();
  return async ({ instruction, threadRef, userId }) => {
    let traceId: string | undefined;
    // Subscribe before handoff so an eagerly-arriving answer is never missed.
    const answer = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        resolve("Work dispatched — I'll post updates in this thread.");
      }, waitMs);
      bridge.onAnswer((msg) => {
        if (msg.kind === 'answer' && traceId !== undefined && msg.traceId === traceId) {
          clearTimeout(timeout);
          resolve(msg.text);
        }
      });
    });
    ({ traceId } = await bridge.handoff({
      instruction,
      memorySnapshot: emptyMemory(),
      threadRef,
      userId,
    }));
    return await answer;
  };
}

/**
 * Handles a "fix AIM-1234" style mention.
 *
 * Returns `true` when the message referenced at least one Linear ticket (and
 * per-ticket replies were posted), `false` when no ticket was referenced so
 * the caller can fall through to the GitHub/freeform paths.
 */
export async function handleTicketWorkRequest(req: TicketWorkRequest): Promise<boolean> {
  const { text, threadTs, channelId, userId, say } = req;
  const refs = extractTicketRefs(text);
  if (refs.length === 0) {
    return false;
  }
  const confirmer = req.confirmer ?? createLinearTicketConfirmer();
  const runWork = req.runWork ?? createLeadSessionRunner();

  for (const identifier of refs) {
    try {
      await say({
        text: `:mag: Confirming ticket ${identifier}…`,
        thread_ts: threadTs,
      });
      const ticket = await confirmer.confirm(identifier);
      if (!ticket) {
        await say({
          text: `:x: Ticket ${identifier} does not exist.`,
          thread_ts: threadTs,
        });
        continue;
      }
      const evidence = await runWork({
        instruction: buildTicketInstruction(ticket),
        threadRef: { threadTs, channelId },
        userId,
      });
      const reply = truncateForSlack(`:white_check_mark: Ticket ${identifier} — ${ticket.title}\n${evidence}`);
      await say({ text: reply, thread_ts: threadTs });
    } catch (err) {
      log.error({ err, identifier }, 'failed to confirm Linear ticket');
      await say({
        text: `:x: Sorry, I couldn't confirm ticket ${identifier}.`,
        thread_ts: threadTs,
      });
    }
  }
  return true;
}
