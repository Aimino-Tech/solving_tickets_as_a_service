import { describe, expect, it } from 'vitest';
import { GoldfishBotExecutor, MemoryBotExecutor } from '../../chat/executors.js';

function input(userText: string, memoryBlock: string) {
  return {
    sessionId: 's1',
    userText,
    memoryBlock,
    recentTranscript: [],
    traceId: 'tr_1',
  };
}

describe('chat executors (AIM-4443/4445)', () => {
  it('memory bot answers from seeded memory', async () => {
    const bot = new MemoryBotExecutor();
    const out = await bot.run(
      input('how does the project setup affect the api design?', '[Memory]\nFacts:\n- project: syntaro'),
    );
    expect(out.reply).toContain('syntaro');
  });

  it('memory bot is honest when no context is recorded', async () => {
    const bot = new MemoryBotExecutor();
    const out = await bot.run(input('hello', ''));
    expect(out.reply).toContain('recorded context');
  });

  it('goldfish bot always asks the user to re-explain (baseline must FAIL harness)', async () => {
    const bot = new GoldfishBotExecutor();
    const out = await bot.run(input('does the plan change?', '[Memory]\nFacts:\n- plan: scaffold'));
    expect(out.reply).toMatch(/repeat|remind|re-explain|do not have|what did you mean/i);
  });

  it('memory bot answers partial token references (friday / storage)', async () => {
    const bot = new MemoryBotExecutor();
    const block =
      '[Memory]\nFacts:\n- project: invoice-service\n- language: TypeScript\nDecisions:\n- We decided to use PostgreSQL for storage -> PostgreSQL for storage\nPlan: to ship the API by Friday [not started]';
    const friday = await bot.run(input('Is the Friday delivery still on track?', block));
    expect(friday.reply).toContain('Friday');
    const storage = await bot.run(input('Remind me what we picked for storage.', block));
    expect(storage.reply.toLowerCase()).toContain('postgresql');
  });
});
