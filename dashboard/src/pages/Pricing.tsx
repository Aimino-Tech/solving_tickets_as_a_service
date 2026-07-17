import { Link } from 'react-router-dom';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic fix runs.',
    price: '$0',
    period: '/month',
    fixes: '10 fixes/mo',
    features: [
      '10 fixes per month',
      'Basic model',
      '1 concurrent fix',
      'Community support',
      'GitHub integration',
    ],
    cta: 'Get Started',
    href: '/login',
    highlighted: false,
  },
  {
    id: 'solo',
    name: 'Solo',
    description: 'For individual developers who need more.',
    price: '$49',
    period: '/month',
    fixes: '100 fixes/mo',
    features: [
      '100 fixes per month',
      'Frontier models (claude-sonnet-4)',
      '3 concurrent fixes',
      'Priority support',
      'Dashboard & analytics',
      'Audit log',
    ],
    cta: 'Subscribe',
    href: '/login',
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For teams that ship fast.',
    price: '$149',
    period: '/month',
    fixes: '500 fixes/mo',
    features: [
      '500 fixes per month',
      'Frontier models (claude-sonnet-4)',
      '10 concurrent fixes',
      'Priority support',
      'Dashboard & analytics',
      'Audit log',
      'Custom webhooks',
      'SLA guarantee',
    ],
    cta: 'Subscribe',
    href: '/login',
    highlighted: false,
  },
];

export default function Pricing() {
  return (
    <div className="space-y-10">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900">Simple, Transparent Pricing</h2>
        <p className="mt-3 text-lg text-gray-600">
          Start free. Scale as you grow. No hidden fees.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`card relative flex flex-col ${
              plan.highlighted
                ? 'border-brand-400 ring-1 ring-brand-400'
                : 'border-gray-200'
            }`}
          >
            {plan.highlighted && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-4 py-1 text-xs font-semibold text-white">
                Most Popular
              </span>
            )}

            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
              <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-sm text-gray-500">{plan.period}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-brand-600">{plan.fixes}</p>
            </div>

            <ul className="mb-8 flex-1 space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              to={plan.href}
              className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                plan.highlighted
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>

      <div className="card border-gray-200 bg-gray-50 text-center">
        <h3 className="text-base font-semibold text-gray-900">Prefer Self-Hosted?</h3>
        <p className="mt-2 text-sm text-gray-600">
          STAS is fully open-source under the MIT license. Self-host with your own API key
          for unlimited fixes and no restrictions.
        </p>
        <a
          href="https://github.com/tamnguyen08/solving_tickets_as_a_service"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
          View on GitHub
        </a>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Frequently Asked Questions</h3>
        <div className="space-y-3">
          <details className="card group cursor-pointer">
            <summary className="text-sm font-medium text-gray-900 group-open:text-brand-600">
              What counts as a &quot;fix&quot;?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              A fix is one complete cycle: issue investigation, code change, test verification,
              and PR creation. Partial or failed runs do not count toward your monthly limit.
            </p>
          </details>
          <details className="card group cursor-pointer">
            <summary className="text-sm font-medium text-gray-900 group-open:text-brand-600">
              Can I switch plans mid-month?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Yes. Upgrades take effect immediately. Downgrades apply at the end of your billing period.
            </p>
          </details>
          <details className="card group cursor-pointer">
            <summary className="text-sm font-medium text-gray-900 group-open:text-brand-600">
              What happens when I hit my limit?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Fixes pause until the next billing period or until you upgrade. You receive a warning at 80% usage.
            </p>
          </details>
          <details className="card group cursor-pointer">
            <summary className="text-sm font-medium text-gray-900 group-open:text-brand-600">
              Is self-hosted really unlimited?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Yes. Self-hosted STAS is MIT-licensed with no usage limits. You only pay for your own
              API usage through OpenCode and your model provider.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
