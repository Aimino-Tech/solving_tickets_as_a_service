/**
 * RealSUT unit tests — fake fetch injected via fetchFn, no server needed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../lib/real-sut.js';
import { RealSUT } from '../lib/real-sut.js';

interface ResponseLike {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

function makeResponse(status: number, body: unknown): ResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

class FakeFetch {
  calls: Array<{ url: string; init: RequestInit }> = [];

  constructor(private readonly handler: (url: string, init: RequestInit) => Promise<ResponseLike>) {}

  fn: FetchLike = (url, init) => {
    this.calls.push({ url, init });
    return this.handler(url, init);
  };
}

function sessionResponse(id: string, overrides: Record<string, unknown> = {}): ResponseLike {
  return makeResponse(200, { id, modelID: 'deepseek-v4-flash', ...overrides });
}

function messageResponse(parts: unknown[], overrides: Record<string, unknown> = {}): ResponseLike {
  return makeResponse(200, { info: { role: 'assistant', finish: 'stop', ...overrides }, parts });
}

const SESSION_BODY = JSON.stringify({ workspace_dir: '/tmp/opencode/eval-sut' });

describe('RealSUT', () => {
  it('creates a session then returns the joined text parts of the assistant reply', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session') && init.method === 'POST') {
        return sessionResponse('ses-1');
      }
      if (url.endsWith('/session/ses-1/message') && init.method === 'POST') {
        return messageResponse([
          { type: 'text', text: 'Hello!' },
          { type: 'tool', tool: 'x' },
          { type: 'text', text: 'More context.' },
        ]);
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    });

    const sut = new RealSUT({ apiKey: 'test-key', fetchFn: fake.fn });
    const reply = await sut.ask('hi');

    expect(reply).toBe('Hello!\nMore context.');
    expect(fake.calls[0].url.endsWith('/session')).toBe(true);
    expect(fake.calls[0].init.body).toBe(SESSION_BODY);
    expect(fake.calls[1].init.body).toBe(JSON.stringify({ parts: [{ type: 'text', text: 'hi' }] }));
  });

  it('sends the api key and content-type headers on every request', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return messageResponse([{ type: 'text', text: 'ok' }]);
    });

    const sut = new RealSUT({ apiKey: 'test-key', fetchFn: fake.fn });
    await sut.ask('hi');

    for (const call of fake.calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['x-opencode-api-key']).toBe('test-key');
      expect(headers['content-type']).toBe('application/json');
    }
  });

  it('opens a fresh session after reset (one conversation per run)', async () => {
    let sessionCounter = 0;
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        sessionCounter += 1;
        return sessionResponse(`ses-${sessionCounter}`);
      }
      if (init.method === 'POST') {
        return messageResponse([{ type: 'text', text: `reply in ${url}` }]);
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await sut.ask('one');
    await sut.ask('two');
    expect(fake.calls.filter((c) => c.url.endsWith('/session')).length).toBe(1);

    await sut.reset();
    await sut.ask('three');
    const sessionCreates = fake.calls.filter((c) => c.url.endsWith('/session'));
    expect(sessionCreates.length).toBe(2);
    expect(sessionCreates[1].init.body).toBe(SESSION_BODY);
  });

  it('throws with the HTTP status and path on non-2xx', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return makeResponse(500, { error: 'boom' });
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await expect(sut.ask('hi')).rejects.toThrow(/HTTP 500 on \/session\/ses-1\/message/);
  });

  it('throws when the response body is not JSON', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return makeResponse(200, 'not json');
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await expect(sut.ask('hi')).rejects.toThrow(/expected JSON object/);
  });

  it('throws when the assistant turn errored (finish = error)', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return messageResponse([], { finish: 'error' });
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await expect(sut.ask('hi')).rejects.toThrow(/assistant turn errored/);
  });

  it('throws when the reply has no text parts', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return messageResponse([{ type: 'tool', tool: 'x' }]);
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await expect(sut.ask('hi')).rejects.toThrow(/no text parts/);
  });

  it('aborts the session on kill and drops the conversation', async () => {
    const aborts: string[] = [];
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      if (url.endsWith('/abort')) {
        aborts.push(url);
        return makeResponse(200, { ok: true });
      }
      return messageResponse([{ type: 'text', text: 'ok' }]);
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn });
    await sut.ask('hi');
    await sut.kill();
    expect(aborts).toEqual(['http://127.0.0.1:20888/session/ses-1/abort']);
    await sut.ask('again');
    expect(fake.calls.filter((c) => c.url.endsWith('/session')).length).toBe(2);
  });

  it('times out when the server never responds', async () => {
    const fake = new FakeFetch(async (url, init) => {
      if (url.endsWith('/session')) {
        return sessionResponse('ses-1');
      }
      return new Promise<ResponseLike>((_resolve, reject) => {
        const signal = init.signal;
        if (signal !== null && signal !== undefined) {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    });

    const sut = new RealSUT({ apiKey: 'k', fetchFn: fake.fn, timeoutMs: 50 });
    await expect(sut.ask('hi')).rejects.toThrow();
  });

  it('reports a stable name derived from the base URL', () => {
    const sut = new RealSUT({
      baseUrl: 'http://127.0.0.1:20888/',
      apiKey: 'k',
      fetchFn: vi.fn() as unknown as FetchLike,
    });
    expect(sut.name).toBe('opencode-serve:http://127.0.0.1:20888');
  });
});
