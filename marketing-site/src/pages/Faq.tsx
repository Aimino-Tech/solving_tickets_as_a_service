import { useEffect, useState } from 'react';

type FaqData = { q: string; a: string }[];
type Section = { label: string; title: string; questions: FaqData };

const sections: Section[] = [
  {
    label: 'Getting Started',
    title: 'Getting Started',
    questions: [
      { q: 'What is STAS?', a: 'STAS is an AI senior architect for GitHub issues. Label an issue with "stas:fix", and STAS reads your entire repository, analyzes root cause, produces a detailed plan, then writes the fix and opens a PR — all without you leaving GitHub.' },
      { q: 'How is STAS different from Copilot or Cursor?', a: 'GitHub Copilot and Cursor are real-time coding assistants — they help you write code as you type. STAS is a plan-first, async AI architect. You label a bug, walk away, and come back to a detailed plan + a PR with the fix. They\'re complementary: use Copilot while coding, use STAS for backlog issues.' },
      { q: 'Do I need to install anything?', a: 'STAS is a GitHub App. Install it in one click from the GitHub Marketplace, grant access to your repos, and you\'re ready. No CLI, no setup scripts, no configuration.' },
      { q: 'Does STAS work with private repos?', a: 'Yes. The free tier works on public repos only. Pro ($19/month) and Team ($49/month) include private repository support.' },
      { q: 'How long does a fix take?', a: 'Most fixes complete in ~60 seconds. Paid tiers get priority queue access (~20 seconds). Complex issues spanning many files may take 2-3 minutes.' },
      { q: 'What does a fix look like?', a: 'STAS produces: (1) a plan explaining root cause and approach, (2) the code changes, (3) a PR description summarizing the fix, and (4) test results confirming existing tests pass and new tests were added.' },
    ],
  },
  {
    label: 'Technical',
    title: 'Technical Details',
    questions: [
      { q: 'What languages does STAS support?', a: 'JavaScript and TypeScript are first-class (best coverage, highest fix rates). Python support is good. Rust, Go, and Java are actively improving. Other languages work but fix rates may be lower.' },
      { q: 'How does STAS read my entire codebase?', a: 'STAS clones your repo, performs AST parsing to understand code structure, builds a dependency graph to trace relationships, then uses a smart context window optimization to include only the relevant files for each issue.' },
      { q: 'Does STAS modify my code without approval?', a: 'No. STAS always produces a plan first. After reviewing the plan, you approve it, and STAS creates a PR in draft mode for you to review before merging. You stay in control.' },
      { q: 'Can STAS handle monorepos?', a: 'Yes. STAS supports configurable scope boundaries so you can limit analysis to specific packages or directories within a monorepo.' },
      { q: 'Does STAS run my tests?', a: 'Yes. STAS runs your existing test suite as part of the quality gate. A fix is only accepted if existing tests pass and new regression tests are added for the bug being fixed.' },
      { q: 'What if the fix is wrong?', a: 'The PR is created as a draft — you review everything before merging. If something looks off, close the PR and add a note. Our fix accuracy rate is 92% across 500+ issues.' },
      { q: 'Can I configure which files STAS should ignore?', a: 'Yes. Add a .stasignore file to your repository root, similar to .gitignore syntax. STAS will skip those files during analysis and fix generation.' },
      { q: 'Does STAS work with CI/CD pipelines?', a: 'Yes. STAS works alongside your existing CI. It runs tests as part of its quality gate and can integrate with GitHub Actions for post-merge validation.' },
    ],
  },
  {
    label: 'Billing',
    title: 'Billing & Plans',
    questions: [
      { q: 'Is there a free tier?', a: 'Yes. The Hobby plan is free: 50 fixes/month on public repositories. Perfect for open-source maintainers and solo developers exploring STAS.' },
      { q: 'What happens when I hit the free limit?', a: 'You\'ll see an upgrade prompt. You cannot exceed the monthly limit until the next billing cycle or until you upgrade to a paid plan.' },
      { q: 'Can I cancel anytime?', a: 'Yes. Monthly plans have no annual commitment. Cancel anytime and your access continues until the end of the billing period.' },
      { q: 'Do you offer refunds?', a: 'Annual plans come with a 14-day money-back guarantee. Monthly plans can be cancelled at any time with no penalty.' },
      { q: 'What counts as a "fix"?', a: 'Each issue-to-PR flow counts as one fix. Re-running STAS on the same issue within 24 hours does not consume additional fixes.' },
    ],
  },
  {
    label: 'Security',
    title: 'Security & Privacy',
    questions: [
      { q: 'Does STAS store my code?', a: 'Fixes are ephemeral. Your code is processed for fix generation and is not stored long-term. Generated PRs live on GitHub as standard pull requests.' },
      { q: 'Where is data processed?', a: 'Cloud customers: data is processed in US or EU regions based on your selection. Self-hosted: everything stays on your infrastructure.' },
      { q: 'Is STAS SOC 2 certified?', a: 'SOC 2 Type I certification is in progress with a target of 6 months. We follow SOC 2 practices today and will publish the report upon completion.' },
      { q: 'Can STAS access my private repos?', a: 'Only the repositories you explicitly grant access to during GitHub App installation. You can revoke access at any time.' },
      { q: 'What happens when I uninstall STAS?', a: 'All access tokens are revoked immediately. Your fix history can be exported within 30 days of uninstallation.' },
      { q: 'Is STAS GDPR compliant?', a: 'Yes. STAS offers GDPR-compliant data processing, EU data residency options, and a Data Processing Agreement (DPA) is available upon request.' },
    ],
  },
  {
    label: 'Troubleshooting',
    title: 'Troubleshooting',
    questions: [
      { q: 'STAS didn\'t respond to my issue comment — what went wrong?', a: 'First, check that the issue has the "stas:fix" label applied. Second, check your GitHub App installation is active. If both are correct, try removing and re-applying the label. For persistent issues, visit our status page or contact support.' },
      { q: 'The fix failed — what do I do?', a: 'Check the plan STAS generated — it\'s attached to the issue as a comment. If the plan was wrong, add more context to the issue description. If the plan was right but the code failed, check your test suite configuration. STAS needs runnable tests to verify fixes.' },
      { q: 'Why did STAS produce a low-quality plan?', a: 'Low-quality plans usually mean STAS lacked sufficient context. Try adding more details to the issue description: error messages, relevant files, reproduction steps. The more context STAS has, the better the plan.' },
      { q: 'STAS can\'t find my repo after installation', a: 'Ensure the GitHub App has been granted access to the specific repository. Go to your repository Settings → GitHub Apps → STAS and verify access is granted. Re-install if needed.' },
      { q: 'The PR has merge conflicts', a: 'STAS creates PRs against the current state of your default branch. If another PR was merged in the meantime, conflicts can occur. Resolve them normally through GitHub\'s conflict resolution interface.' },
      { q: 'How do I report a bug in STAS output?', a: 'Open an issue on our GitHub repository with: the original issue, the plan STAS generated, the actual output, and what you expected. We review all reports and use them to improve fix quality.' },
    ],
  },
];

function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="faq-item">
      <button className={`faq-question${open ? ' open' : ''}`} onClick={onToggle} aria-expanded={open}>
        {q}
      </button>
      <div className={`faq-answer${open ? ' open' : ''}`}>
        <p>{a}</p>
      </div>
    </div>
  );
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: sections.flatMap((s) =>
    s.questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    }))
  ),
};

export default function Faq() {
  const [openIndex, setOpenIndex] = useState<Record<string, number | null>>({});

  useEffect(() => {
    document.title = 'FAQ — STAS';
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  const toggle = (sectionIdx: number, qIdx: number) => {
    const key = `${sectionIdx}`;
    setOpenIndex((prev) => ({
      ...prev,
      [key]: prev[key] === qIdx ? null : qIdx,
    }));
  };

  return (
    <>
      <section className="section" style={{ paddingTop: 140 }}>
        <div className="section-header">
          <div className="label">FAQ</div>
          <h2>Frequently Asked Questions</h2>
          <p className="sub">
            Everything you need to know about STAS. Can't find what you're looking for?{' '}
            <a href="/support">Contact support</a>.
          </p>
        </div>

        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: 48 }}>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, fontFamily: 'var(--font-sans)' }}>
              {section.title}
            </h3>
            <div className="faq-list">
              {section.questions.map((q, qi) => (
                <FaqItem
                  key={qi}
                  q={q.q}
                  a={q.a}
                  open={openIndex[`${si}`] === qi}
                  onToggle={() => toggle(si, qi)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="cta-section">
        <div className="section-header">
          <h2>Still have questions?</h2>
          <p className="sub">
            We're here to help. Reach out and we'll get back to you within 24 hours.
          </p>
          <div className="btn-group">
            <a href="/support" className="btn btn-primary">Contact Support</a>
            <a href="https://github.com/apps/stasgithub1/installations/new" className="btn btn-secondary">Install STAS →</a>
          </div>
        </div>
      </section>
    </>
  );
}
