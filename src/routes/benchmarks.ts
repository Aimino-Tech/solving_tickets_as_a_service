import { Router, type Request, type Response } from 'express';

const router: Router = Router();


export interface BenchmarkEntry {
  agent: string;
  passRate: number;
  costPerFixCents: number;
  agentNative: boolean;
  oss: boolean;
  selfHostable: boolean;
  note?: string;
}

export interface PriceEntry {
  agent: string;
  model: string;
  costPerFixCents: number;
  monthlyMinCents: number;
  monthlyMaxFixes: number;
}

const BENCHMARK_DATA: BenchmarkEntry[] = [
  {
    agent: 'STAS (claude-sonnet-4)',
    passRate: 0.92,
    costPerFixCents: 380,
    agentNative: true,
    oss: true,
    selfHostable: true,
  },
  {
    agent: 'Claude Opus 4.5 (direct)',
    passRate: 0.457,
    costPerFixCents: 264,
    agentNative: false,
    oss: false,
    selfHostable: true,
    note: 'XOR baseline — no agent orchestration',
  },
  {
    agent: 'GPT-5.5 DeepSWE',
    passRate: 0.70,
    costPerFixCents: 580,
    agentNative: false,
    oss: false,
    selfHostable: false,
    note: 'Best proprietary agent on XOR',
  },
  {
    agent: 'STAS + Opus 4.6 (self-host)',
    passRate: 0.475,
    costPerFixCents: 5188,
    agentNative: true,
    oss: true,
    selfHostable: true,
    note: 'Self-hosted agent — high cost at small scale',
  },
  {
    agent: 'Plip.io',
    passRate: 0.42,
    costPerFixCents: 350,
    agentNative: true,
    oss: false,
    selfHostable: false,
    note: 'SaaS only — no self-host option',
  },
  {
    agent: 'Devin',
    passRate: 0.38,
    costPerFixCents: 800,
    agentNative: true,
    oss: false,
    selfHostable: false,
    note: 'Premium SaaS — $500/mo plan',
  },
  {
    agent: 'Cursor Agent',
    passRate: 0.35,
    costPerFixCents: 200,
    agentNative: true,
    oss: false,
    selfHostable: false,
    note: 'IDE-integrated — limited to editor scope',
  },
];

const PRICE_DATA: PriceEntry[] = [
  {
    agent: 'STAS (Cloud Free)',
    model: 'claude-sonnet-4',
    costPerFixCents: 0,
    monthlyMinCents: 0,
    monthlyMaxFixes: 10,
  },
  {
    agent: 'STAS (Cloud Solo)',
    model: 'claude-sonnet-4',
    costPerFixCents: 49,
    monthlyMinCents: 4900,
    monthlyMaxFixes: 100,
  },
  {
    agent: 'STAS (Cloud Team)',
    model: 'claude-sonnet-4',
    costPerFixCents: 30,
    monthlyMinCents: 14900,
    monthlyMaxFixes: 500,
  },
  {
    agent: 'Plip.io',
    model: 'Claude',
    costPerFixCents: 350,
    monthlyMinCents: 0,
    monthlyMaxFixes: 10,
  },
  {
    agent: 'Devin',
    model: 'Custom',
    costPerFixCents: 800,
    monthlyMinCents: 50000,
    monthlyMaxFixes: 50,
  },
  {
    agent: 'Cursor',
    model: 'GPT-4o / Claude',
    costPerFixCents: 200,
    monthlyMinCents: 2000,
    monthlyMaxFixes: 100,
  },
];

router.get('/', (_req: Request, res: Response) => {
  res.json({
    generatedAt: new Date().toISOString(),
    source: 'XOR Benchmark + self-reported data',
    disclaimer: 'Results based on public XOR benchmark and self-reported metrics.',
    competitors: BENCHMARK_DATA,
  });
});

router.get('/price', (_req: Request, res: Response) => {
  res.json({
    generatedAt: new Date().toISOString(),
    currency: 'USD',
    prices: PRICE_DATA,
  });
});

export { router as benchmarksRouter };
