import { describe, expect, it, vi } from 'vitest';
import type { LinearTicketInfo } from '../../../channels/slack/ticketConfirm.js';
import {
  buildTicketInstruction,
  createLeadSessionRunner,
  handleTicketWorkRequest,
} from '../../../channels/slack/ticketWork.js';
import { SLACK_TEXT_LIMIT } from '../../../channels/slack/truncate.js';
import { ChatLeadBridge } from '../../../chat/bridge.js';

function makeTicket(overrides: Partial<LinearTicketInfo> = {}): LinearTicketInfo {
  return {
    id: 'uuid-1',
    identifier: 'AIM-4441',
    title: 'Fix the bridge',
    description: 'The bridge returns 500s.',
    url: 'https://linear.app/aimino/issue/AIM-4441/xyz',
    state: { name: 'Todo', type: 'unstarted' },
    ...overrides,
  };
}

function makeSay() {
  const say = vi.fn(async () => undefined);
  return say as ReturnType<typeof vi.fn> & ((msg: Record<string, unknown>) => Promise<void>);
}

describe('handleTicketWorkRequest', () => {
  it('confirms the ticket, runs work, and posts an evidence reply in-thread', async () => {
    const ticket = makeTicket();
    const confirm = vi.fn(async () => ticket);
    const runWork = vi.fn(async () => 'Tests pass: 12/12. Changed bridge.ts.');
    const say = makeSay();
    const handled = await handleTicketWorkRequest({
      text: 'fix AIM-4441',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm },
      runWork,
    });

    expect(handled).toBe(true);
    expect(confirm).toHaveBeenCalledWith('AIM-4441');
    expect(runWork).toHaveBeenCalledWith({
      instruction: 'Implement ticket AIM-4441: Fix the bridge\n\nThe bridge returns 500s.',
      threadRef: { threadTs: 't1', channelId: 'c1' },
      userId: 'u1',
    });
    expect(say).toHaveBeenCalledWith({ text: ':mag: Confirming ticket AIM-4441…', thread_ts: 't1' });
    expect(say).toHaveBeenCalledWith({
      text: ':white_check_mark: Ticket AIM-4441 — Fix the bridge\nTests pass: 12/12. Changed bridge.ts.',
      thread_ts: 't1',
    });
  });

  it('replies with does-not-exist when the ticket is missing and skips work', async () => {
    const confirm = vi.fn(async () => null);
    const runWork = vi.fn(async () => 'should not run');
    const say = makeSay();
    const handled = await handleTicketWorkRequest({
      text: 'fix AIM-9999',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm },
      runWork,
    });

    expect(handled).toBe(true);
    expect(say).toHaveBeenCalledWith({ text: ':x: Ticket AIM-9999 does not exist.', thread_ts: 't1' });
    expect(runWork).not.toHaveBeenCalled();
  });

  it('returns false and posts nothing when no ticket is referenced', async () => {
    const confirm = vi.fn();
    const say = makeSay();
    const handled = await handleTicketWorkRequest({
      text: 'good morning',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm },
    });

    expect(handled).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it('replies per-ticket for multiple references', async () => {
    const confirm = vi.fn(async (identifier: string) =>
      identifier === 'AIM-1' ? makeTicket({ identifier: 'AIM-1', title: 'One' }) : null,
    );
    const runWork = vi.fn(async () => 'done');
    const say = makeSay();
    const handled = await handleTicketWorkRequest({
      text: 'fix AIM-1 and AIM-2',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm },
      runWork,
    });

    expect(handled).toBe(true);
    expect(say).toHaveBeenCalledWith({
      text: ':white_check_mark: Ticket AIM-1 — One\ndone',
      thread_ts: 't1',
    });
    expect(say).toHaveBeenCalledWith({ text: ':x: Ticket AIM-2 does not exist.', thread_ts: 't1' });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('posts a sorry reply when confirmation fails', async () => {
    const confirm = vi.fn(async () => {
      throw new Error('Unauthorized');
    });
    const runWork = vi.fn();
    const say = makeSay();
    const handled = await handleTicketWorkRequest({
      text: 'fix AIM-4441',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm },
      runWork,
    });

    expect(handled).toBe(true);
    expect(say).toHaveBeenCalledWith({
      text: ":x: Sorry, I couldn't confirm ticket AIM-4441.",
      thread_ts: 't1',
    });
    expect(runWork).not.toHaveBeenCalled();
  });

  it('truncates oversized evidence replies to the Slack byte limit', async () => {
    const runWork = vi.fn(async () => 'x'.repeat(10_000));
    const say = makeSay();
    await handleTicketWorkRequest({
      text: 'fix AIM-4441',
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      say,
      confirmer: { name: 'linear', confirm: vi.fn(async () => makeTicket()) },
      runWork,
    });

    const replyCall = say.mock.calls.find(([msg]) => String(msg.text).startsWith(':white_check_mark:'));
    expect(replyCall).toBeDefined();
    const text = String(replyCall?.[0].text);
    // Truncation keeps the body within the limit and appends a 3-byte "…".
    expect(Buffer.byteLength(text.slice(0, -1), 'utf8')).toBeLessThanOrEqual(SLACK_TEXT_LIMIT);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('buildTicketInstruction', () => {
  it('includes the description when present', () => {
    const ticket = makeTicket();
    expect(buildTicketInstruction(ticket)).toBe(
      'Implement ticket AIM-4441: Fix the bridge\n\nThe bridge returns 500s.',
    );
  });

  it('omits the description when absent', () => {
    const ticket = makeTicket({ description: null });
    expect(buildTicketInstruction(ticket)).toBe('Implement ticket AIM-4441: Fix the bridge');
  });
});

describe('createLeadSessionRunner', () => {
  it('resolves with the lead session answer for the matching traceId', async () => {
    const bridge = new ChatLeadBridge();
    const handoffSpy = vi.spyOn(bridge, 'handoff').mockResolvedValue({
      traceId: 'tr_test',
      durable: false,
      message: {
        kind: 'instruction',
        traceId: 'tr_test',
        instruction: 'Implement ticket AIM-4441: Fix the bridge',
        memorySnapshot: { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
        threadRef: { threadTs: 't1', channelId: 'c1' },
        workType: 'short',
      },
    });
    const runner = createLeadSessionRunner({ bridge, waitMs: 100 });
    const promise = runner({
      instruction: 'Implement ticket AIM-4441: Fix the bridge',
      threadRef: { threadTs: 't1', channelId: 'c1' },
      userId: 'u1',
    });
    // Let the mocked handoff resolve so the runner captures its traceId.
    await Promise.resolve();
    bridge.receive({ kind: 'answer', traceId: 'tr_test', text: 'Tests pass: 12/12.' });
    await expect(promise).resolves.toBe('Tests pass: 12/12.');
    expect(handoffSpy).toHaveBeenCalledOnce();
  });

  it('falls back gracefully when no answer arrives in time', async () => {
    const bridge = new ChatLeadBridge();
    const runner = createLeadSessionRunner({ bridge, waitMs: 20 });
    await expect(
      runner({
        instruction: 'Implement ticket AIM-4441: Fix the bridge',
        threadRef: { threadTs: 't1', channelId: 'c1' },
        userId: 'u1',
      }),
    ).resolves.toBe("Work dispatched — I'll post updates in this thread.");
  });
});
