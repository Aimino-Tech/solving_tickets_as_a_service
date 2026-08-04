import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

describe('app bundle code-splitting (AIM-4450)', () => {
  it('lazy-loads the heavy/rarely-visited pages via React.lazy', () => {
    const lazyPages = [
      'Benchmarks',
      'PricingPage',
      'VsPage',
      'Billing',
      'Settings',
      'DashboardHome',
      'RunsHistory',
      'RunDetail',
      'Repos',
      'AuditLog',
      'LiveView',
      'EnterprisePage',
      'Security',
      'Privacy',
      'Status',
      'DPAPage',
      'onboarding/WizardContainer',
    ];

    for (const page of lazyPages) {
      expect(appSource, `expected ${page} to be loaded via React.lazy`).toContain(
        `lazy(() => import('@/pages/${page}'))`,
      );
    }
  });

  it('keeps Login eager so the mobile first paint never blocks', () => {
    expect(appSource).toContain("import Login from '@/pages/Login'");
    expect(appSource).not.toContain(`lazy(() => import('@/pages/Login'))`);
  });

  it('keeps NotFound and Error500 eager for fast error rendering', () => {
    expect(appSource).toContain("import NotFound from '@/pages/NotFound'");
    expect(appSource).toContain("import Error500 from '@/pages/Error500'");
  });

  it('does not eagerly import recharts from App.tsx', () => {
    expect(appSource).not.toContain("from 'recharts'");
  });

  it('wraps the route tree in Suspense', () => {
    expect(appSource).toMatch(/<Suspense\b/);
    expect(appSource).toMatch(/<Suspense\b[^>]*>[\s\S]*<\/Suspense>/);
  });
});
