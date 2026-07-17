import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-api' });

const router: Router = Router();

export interface PricingPlan {
  id: string; name: string; description: string; price: string; period: string;
  fixes: string; monthlyFixLimit: number; concurrentFixes: number;
  premiumModels: boolean; prioritySupport: boolean; customWebhooks: boolean;
  sla: boolean; features: string[]; cta: string; highlighted: boolean;
}

const PLANS: PricingPlan[] = [
  { id: 'free', name: 'Free', description: 'Get started with basic fix runs.',
    price: '$0', period: '/month', fixes: '10 fixes/mo', monthlyFixLimit: 10,
    concurrentFixes: 1, premiumModels: false, prioritySupport: false,
    customWebhooks: false, sla: false,
    features: ['10 fixes per month', 'Basic model', '1 concurrent fix', 'Community support', 'GitHub integration'],
    cta: 'Get Started', highlighted: false },
  { id: 'solo', name: 'Solo', description: 'For individual developers who need more.',
    price: '$49', period: '/month', fixes: '100 fixes/mo', monthlyFixLimit: 100,
    concurrentFixes: 3, premiumModels: true, prioritySupport: true,
    customWebhooks: false, sla: false,
    features: ['100 fixes per month', 'Premium AGI model', '3 concurrent fixes', 'Priority support', 'Dashboard & analytics', 'Audit log'],
    cta: 'Subscribe', highlighted: true },
  { id: 'team', name: 'Team', description: 'For teams that ship fast.',
    price: '$149', period: '/month', fixes: '500 fixes/mo', monthlyFixLimit: 500,
    concurrentFixes: 10, premiumModels: true, prioritySupport: true,
    customWebhooks: true, sla: true,
    features: ['500 fixes per month', 'Premium AGI model', '10 concurrent fixes', 'Priority support', 'Dashboard & analytics', 'Audit log', 'Custom webhooks', 'SLA guarantee'],
    cta: 'Subscribe', highlighted: false },
  { id: 'enterprise', name: 'Enterprise', description: 'For organizations at scale.',
    price: 'Custom', period: '', fixes: 'Unlimited', monthlyFixLimit: 999_999,
    concurrentFixes: 50, premiumModels: true, prioritySupport: true,
    customWebhooks: true, sla: true,
    features: ['Unlimited fixes', 'Premium AGI model', '50 concurrent fixes', 'Dedicated support', 'Full analytics', 'Custom webhooks', 'SSO / SAML / SCIM'],
    cta: 'Contact Sales', highlighted: false },
];

export interface CompetitorPrice {
  competitor: string; monthlyCostCents: number; costPerFixCents: number;
  fixesPerMonth: number; passRate: number; selfHosted: boolean;
  openSource: boolean; ourAgi: boolean;
}

const COMPETITOR_PRICES: CompetitorPrice[] = [
  { competitor: 'STAS (Cloud Solo)', monthlyCostCents: 4900, costPerFixCents: 49, fixesPerMonth: 100, passRate: 0.92, selfHosted: true, openSource: true, ourAgi: true },
  { competitor: 'STAS (Cloud Team)', monthlyCostCents: 14900, costPerFixCents: 30, fixesPerMonth: 500, passRate: 0.92, selfHosted: true, openSource: true, ourAgi: true },
  { competitor: 'Plip.io', monthlyCostCents: 10000, costPerFixCents: 350, fixesPerMonth: 10, passRate: 0.42, selfHosted: false, openSource: false, ourAgi: false },
  { competitor: 'Devin', monthlyCostCents: 50000, costPerFixCents: 800, fixesPerMonth: 50, passRate: 0.38, selfHosted: false, openSource: false, ourAgi: false },
  { competitor: 'GitHub Copilot', monthlyCostCents: 1900, costPerFixCents: 200, fixesPerMonth: 10, passRate: 0.35, selfHosted: false, openSource: false, ourAgi: false },
  { competitor: 'Cursor Agent', monthlyCostCents: 2000, costPerFixCents: 200, fixesPerMonth: 10, passRate: 0.35, selfHosted: false, openSource: false, ourAgi: false },
  { competitor: 'Open SWE', monthlyCostCents: 0, costPerFixCents: 264, fixesPerMonth: 100, passRate: 0.457, selfHosted: true, openSource: true, ourAgi: false },
];

interface VsCategoryItem { feature: string; us: string; them: string; advantage: 'us' | 'them' | 'tie'; }
interface VsCategory { name: string; items: VsCategoryItem[]; }

const VS_DATA: Record<string, {
  competitorName: string; tagline: string; ourAdvantage: string;
  categories: VsCategory[];
  priceComparison: { ourMonthlyCents: number; theirMonthlyCents: number; ourPerFixCents: number; theirPerFixCents: number; annualSavingsCents: number };
  benchmarkComparison: { ourPassRate: number; theirPassRate: number; ourCostPerFixCents: number; theirCostPerFixCents: number };
}> = {
  copilot: {
    competitorName: 'GitHub Copilot',
    tagline: 'AI pair programmer, not an autonomous fix agent',
    ourAdvantage: 'STAS is purpose-built for autonomous bug fixing.',
    categories: [
      { name: 'Core Capability', items: [
        { feature: 'Autonomous fix from issue', us: 'Yes', them: 'No', advantage: 'us' },
        { feature: 'PR creation', us: 'Automatic', them: 'Manual', advantage: 'us' },
        { feature: 'Test verification', us: 'Automatic', them: 'Manual', advantage: 'us' },
      ]},
      { name: 'Quality & Performance', items: [
        { feature: 'Pass rate', us: '92%', them: '35%', advantage: 'us' },
        { feature: 'Cost per fix', us: '$0.49', them: '$2.00', advantage: 'us' },
      ]},
      { name: 'Business Model', items: [
        { feature: 'Open source', us: 'Yes', them: 'No', advantage: 'us' },
        { feature: 'Self-hostable', us: 'Yes', them: 'No', advantage: 'us' },
      ]},
    ],
    priceComparison: { ourMonthlyCents: 4900, theirMonthlyCents: 19000, ourPerFixCents: 49, theirPerFixCents: 200, annualSavingsCents: 169200 },
    benchmarkComparison: { ourPassRate: 0.92, theirPassRate: 0.35, ourCostPerFixCents: 49, theirCostPerFixCents: 200 },
  },
  devin: {
    competitorName: 'Devin',
    tagline: 'Premium AI agent with a premium price tag',
    ourAdvantage: 'STAS delivers better results at a fraction of the cost.',
    categories: [
      { name: 'Core Capability', items: [
        { feature: 'Autonomous fix', us: 'Yes', them: 'Yes', advantage: 'tie' },
        { feature: 'Test verification', us: 'Regression gate', them: 'Basic check', advantage: 'us' },
      ]},
      { name: 'Quality & Performance', items: [
        { feature: 'Pass rate', us: '92%', them: '38%', advantage: 'us' },
        { feature: 'Cost per fix', us: '$0.49', them: '$8.00', advantage: 'us' },
      ]},
      { name: 'Business Model', items: [
        { feature: 'Monthly price', us: '$49', them: '$500', advantage: 'us' },
        { feature: 'Open source', us: 'Yes', them: 'No', advantage: 'us' },
      ]},
    ],
    priceComparison: { ourMonthlyCents: 4900, theirMonthlyCents: 50000, ourPerFixCents: 49, theirPerFixCents: 800, annualSavingsCents: 541200 },
    benchmarkComparison: { ourPassRate: 0.92, theirPassRate: 0.38, ourCostPerFixCents: 49, theirCostPerFixCents: 800 },
  },
  plip: {
    competitorName: 'Plip.io',
    tagline: 'Label-triggered fix bot — closest competitor',
    ourAdvantage: 'STAS beats Plip on every metric.',
    categories: [
      { name: 'Core Capability', items: [
        { feature: 'Label-triggered fix', us: 'Yes', them: 'Yes', advantage: 'tie' },
        { feature: 'Test verification', us: 'Regression gate', them: 'Basic check', advantage: 'us' },
        { feature: 'Multi-platform', us: 'GitHub, GitLab, Bitbucket', them: 'GitHub only', advantage: 'us' },
      ]},
      { name: 'Quality & Performance', items: [
        { feature: 'Pass rate', us: '92%', them: '42%', advantage: 'us' },
        { feature: 'Cost per fix', us: '$0.49', them: '$3.50', advantage: 'us' },
      ]},
      { name: 'Business Model', items: [
        { feature: 'Open source', us: 'Yes', them: 'No', advantage: 'us' },
        { feature: 'Self-hostable', us: 'Yes', them: 'No', advantage: 'us' },
      ]},
    ],
    priceComparison: { ourMonthlyCents: 4900, theirMonthlyCents: 10000, ourPerFixCents: 49, theirPerFixCents: 350, annualSavingsCents: 61200 },
    benchmarkComparison: { ourPassRate: 0.92, theirPassRate: 0.42, ourCostPerFixCents: 49, theirCostPerFixCents: 350 },
  },
};

router.get('/', (_req: Request, res: Response) => {
  res.json({ generatedAt: new Date().toISOString(), plans: PLANS, competitors: COMPETITOR_PRICES });
});

router.get('/calculate', (req: Request, res: Response) => {
  const fixesPerMonth = Math.max(1, Math.min(9999, Number(req.query.fixes) || 50));
  const tierId = (req.query.tier as string) || 'solo';
  const plan = PLANS.find((p) => p.id === tierId) || PLANS[1];
  const monthlyCostCents = plan.id === 'free' ? 0 : plan.id === 'enterprise' ? 149000 : parseInt(plan.price.replace(/[$,]/g, '')) * 100;
  const costPerFixCents = plan.monthlyFixLimit > 0 ? Math.round(monthlyCostCents / Math.min(fixesPerMonth, plan.monthlyFixLimit)) : 0;
  const vsCompetitors = COMPETITOR_PRICES.filter((c) => !c.ourAgi).map((c) => {
    const theirMonthly = c.monthlyCostCents > 0 ? c.monthlyCostCents : fixesPerMonth * c.costPerFixCents;
    return { name: c.competitor, monthlyCostCents: theirMonthly, savingsCents: Math.max(0, theirMonthly - monthlyCostCents), savingsPercent: theirMonthly > 0 ? Math.round((Math.max(0, theirMonthly - monthlyCostCents) / theirMonthly) * 100) : 0 };
  });
  res.json({ fixesPerMonth, monthlyCostCents, costPerFixCents, annualSavingsCents: 0, vsCompetitors });
});

router.get('/vs/:competitor', (req: Request, res: Response) => {
  const key = req.params.competitor.toLowerCase();
  const comparison = VS_DATA[key];
  if (!comparison) { res.status(404).json({ error: 'Unknown competitor' }); return; }
  res.json({ competitor: key, ...comparison });
});

export { router as pricingRouter };
