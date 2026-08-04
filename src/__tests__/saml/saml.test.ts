import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerChild = {
  child: vi.fn(() => mockLoggerChild),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => mockLoggerChild) } }));

vi.mock('../../config.js', () => ({
  config: {
    saml: {
      tenantId: 'acme',
      tenantName: 'Acme Corp',
      spEntityId: 'https://syntaro.dev/saml/metadata',
      spAcsUrl: '',
      idpIssuer: 'https://idp.example.com',
      idpSsoUrl: 'https://idp.example.com/sso',
      idpCert: '',
      dashboardUrl: 'https://app.syntaro.dev',
    },
    nodeEnv: 'test',
  },
}));

// Real middleware module — in-memory tenant registry + session store.
let router: any;

function mockReqRes(method: string, path: string, body?: unknown) {
  const req = {
    method,
    path,
    url: path,
    query: {},
    params: {},
    cookies: {},
    headers: {},
    body,
  };
  const res = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    end: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

function matchesPath(routePath: string, path: string, req: any): boolean {
  const routeSegments = routePath.split('/');
  const pathSegments = path.split('/');
  if (routeSegments.length !== pathSegments.length) return false;
  for (let i = 0; i < routeSegments.length; i += 1) {
    if (routeSegments[i].startsWith(':')) {
      req.params[routeSegments[i].slice(1)] = pathSegments[i];
    } else if (routeSegments[i] !== pathSegments[i]) {
      return false;
    }
  }
  return true;
}

async function invokeRoute(routerToUse: any, method: string, path: string, req: any, res: any) {
  const stack = routerToUse.stack ?? [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const routeMethods = Object.keys(layer.route.methods ?? {}).filter((m) => m !== '_all');
    if (routeMethods.includes(method.toLowerCase()) && matchesPath(layer.route.path, path, req)) {
      for (const handler of layer.route.stack) {
        await handler.handle(req, res, () => {});
      }
      return;
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../routes/saml.js');
  router = mod.default;
});

describe('SAML routes', () => {
  it('serves SP metadata as XML when a tenant is configured', async () => {
    const { req, res } = mockReqRes('GET', '/metadata');
    await invokeRoute(router, 'GET', '/metadata', req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.send as any).mock.calls[0][0] as string;
    expect(body).toContain('EntityDescriptor');
    expect(body).toContain('entityID="https://syntaro.dev/saml/metadata"');
    expect(body).toContain('AssertionConsumerService');
    expect((res.setHeader as any).mock.calls.some((c: unknown[]) => c[1] === 'application/xml')).toBe(true);
  });

  it('redirects to the IdP SSO URL on login when a tenant is configured', async () => {
    const { req, res } = mockReqRes('GET', '/login');
    await invokeRoute(router, 'GET', '/login', req, res);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://idp.example.com/sso');
  });

  it('accepts a SAMLResponse at the ACS and establishes a session', async () => {
    const samlResponse = Buffer.from('<saml:NameID>user@example.com</saml:NameID>', 'utf-8').toString('base64');
    const { req, res } = mockReqRes('POST', '/acs', { SAMLResponse: samlResponse });
    await invokeRoute(router, 'POST', '/acs', req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'syntaro_saml_token',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://app.syntaro.dev');
  });

  it('rejects an ACS request without a SAMLResponse', async () => {
    const { req, res } = mockReqRes('POST', '/acs', {});
    await invokeRoute(router, 'POST', '/acs', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('clears the SAML session cookie on logout', async () => {
    const { req, res } = mockReqRes('GET', '/logout');
    req.headers.cookie = 'syntaro_saml_token=abc123';
    await invokeRoute(router, 'GET', '/logout', req, res);

    expect(res.clearCookie).toHaveBeenCalledWith('syntaro_saml_token');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://app.syntaro.dev');
  });
});
