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

    const result = await new Promise((resolve) => {
      const req = {
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json' },
        body: { foo: 'bar' },
        _body: true,
      };
      const json = vi.fn().mockImplementation((data) => { resolve(data); });
      const res = { json, status: vi.fn().mockReturnValue({ json }) };
      app(req, res, () => { resolve(null); });
    });
    expect(result).toEqual({ ok: true });
  });
});
