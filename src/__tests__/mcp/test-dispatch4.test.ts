import { describe, expect, it, vi } from 'vitest';
import express from 'express';

describe('express handle', () => {
  it('app() routing works with mock req/res', async () => {
    const app = express();
    const router = express.Router();
    router.post('/test', (req, res) => {
      res.json({ ok: true });
    });
    app.use(express.json());
    app.use(router);

    const result = await new Promise((resolve, reject) => {
      const req = {
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json' },
        body: { foo: 'bar' },
        socket: { setTimeout: vi.fn() },
        _body: true,
      };
      const json = vi.fn().mockImplementation((data) => { resolve(data); });
      const res = { 
        json, 
        status: vi.fn().mockReturnValue({ json }),
        end: vi.fn(),
        write: vi.fn(),
        writeHead: vi.fn(),
        getHeader: vi.fn(),
        setHeader: vi.fn(),
        removeHeader: vi.fn(),
      };
      app(req, res, () => { resolve('fallback'); });
    });
    expect(result).toEqual({ ok: true });
  });
});
