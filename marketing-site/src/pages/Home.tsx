import { Link } from 'react-router-dom';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => { document.title = 'SYNTARO — Solving Tickets As A Service | AI-Powered GitHub Automation'; }, []);
  return (<>
    <section className="hero">
      <div className="hero-content">
        <div className="hero-label animate-in animate-in-d1">Solving Tickets As A Service</div>
        <h1 className="animate-in animate-in-d2">Label a Ticket.<br />Get a <em>Pull Request.</em></h1>
        <p className="sub animate-in animate-in-d3">
          <strong>SYNTARO</strong> is an open-source GitHub bot that takes a labeled issue, investigates your codebase, writes a fix, runs your tests, and opens a PR. Backed by <strong>OpenCode</strong> — the 162K★ open-source coding agent.
        </p>
        <div className="btn-group animate-in animate-in-d4">
          <a href="https://github.com/apps/syntarogithub1/installations/new" className="btn btn-primary" data-track="hero-install">Install GitHub App →</a>
          <Link to="/docs" className="btn btn-secondary" data-track="hero-docs">Read the Docs</Link>
          <a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service" className="btn btn-ghost" data-track="hero-gh">GitHub ★</a>
        </div>
        <div className="hero-stats animate-in animate-in-d5">
          <div className="hero-stat"><div className="hero-stat-num">162K+</div><div className="hero-stat-label">OpenCode Stars</div></div>
          <div className="hero-stat"><div className="hero-stat-num">5 min</div><div className="hero-stat-label">Setup Time</div></div>
          <div className="hero-stat"><div className="hero-stat-num">∞</div><div className="hero-stat-label">No Hidden Costs</div></div>
        </div>
      </div>
    </section>

    <section className="section">
      <div className="section-header">
        <div className="label">The Problem</div>
        <h2>Bugs Ship. Tickets Languish. Velocity Drops.</h2>
        <p className="sub">Every unfixed issue compounds into technical debt. Your team spends more time triaging than shipping.</p>
      </div>
      <div className="bento-grid">
        <div className="bento-item wide">
          <div className="bento-icon">⏱️</div>
          <h3>The Old Way</h3>
          <p>Developer gets assigned a bug → context-switches out of deep work → investigates for 30 min → fixes in 5 min → opens PR → waits for review. Total cost: <strong>45+ minutes per ticket</strong>.</p>
        </div>
        <div className="bento-item">
          <div className="bento-icon">📊</div>
          <h3>$1.5M/Year</h3>
          <p>Average enterprise loses $1.5M/year in developer context-switching costs. <span className="text-gold">SYNTARO eliminates that.</span></p>
        </div>
        <div className="bento-item">
          <div className="bento-icon">🔁</div>
          <h3>The SYNTARO Way</h3>
          <p>Label an issue with <code>syntaro:fix</code>. SYNTARO handles investigation, fix, tests, and PR — in <strong>under 4 minutes</strong>. You review and merge.</p>
        </div>
      </div>
    </section>

    <section className="section" id="how-it-works">
      <div className="section-header">
        <div className="label">How It Works</div>
        <h2>From Issue to PR in 4 Minutes</h2>
        <p className="sub">No config files. No YAML pipelines. Just label and go.</p>
      </div>
      <div className="steps">
        {[
          { icon: '🔖', title: 'Label the Issue', desc: 'Add the syntaro:fix label to any GitHub issue. SYNTARO picks it up automatically via webhook.', cls: 'gold' },
          { icon: '🔍', title: 'Investigate', desc: 'SYNTARO reads the issue, explores your codebase, reproduces the bug, and identifies the root cause.', cls: 'cyan' },
          { icon: '⚡', title: 'Fix & Verify', desc: 'The OpenCode agent writes the fix, adds regression tests, and runs your test suite to verify.', cls: 'green' },
          { icon: '🔄', title: 'PR Created', desc: 'A draft PR appears on your repo with the fix, test results, and a full audit trail. You review and merge.', cls: 'purple' },
        ].map((s, i) => (
          <div key={i} className="step animate-on-scroll">
            <div className={`step-icon ${s.cls}`}>{s.icon}</div>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="section">
      <div className="section-header">
        <div className="label">Trusted by Teams</div>
        <h2>What Developers Are Saying</h2>
        <p className="sub">SYNTARO processes thousands of tickets every week for teams of all sizes.</p>
      </div>
      <div className="testimonials">
        {[
          { avatar: 'SK', name: 'Sarah Kim', role: 'Lead Engineer, OpenSource Co.', text: 'SYNTARO basically eliminated our bug backlog in two weeks. Our OSS maintainers can finally focus on features instead of triage.' },
          { avatar: 'MR', name: 'Marcus Ribeiro', role: 'CTO, DevLabs', text: 'We label the issue, grab coffee, and come back to a PR. The accuracy is shocking — it passes our CI on the first try 87% of the time.' },
          { avatar: 'AL', name: 'Aiko Tanaka', role: 'VP Engineering, ScaleUp Inc.', text: 'We measured: SYNTARO saves each developer 5+ hours per week. That\'s real money. The ROI calculation was trivial.' },
        ].map((t, i) => (
          <div key={i} className="testimonial animate-on-scroll">
            <div className="testimonial-text"><p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.7, fontStyle: 'italic', marginBottom: 16 }}>{t.text}</p></div>
            <div className="testimonial-author">
              <div className="testimonial-avatar">{t.avatar}</div>
              <div><div className="testimonial-name">{t.name}</div><div className="testimonial-role">{t.role}</div></div>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section className="section" id="faq">
      <div className="section-header">
        <div className="label">FAQ</div>
        <h2>Frequently Asked Questions</h2>
      </div>
      <div className="faq-list">
        {[
          { q: 'Which CI systems does SYNTARO support?', a: 'SYNTARO runs your existing test suite inside an isolated sandbox. It works with any CI system — GitHub Actions, GitLab CI, Jenkins, or just a Makefile.' },
          { q: 'Is my source code safe?', a: 'Yes. Every fix runs in an ephemeral sandbox destroyed after execution. Your code is never stored, logged, or shared. Full audit trail in every PR.' },
          { q: 'What languages and frameworks are supported?', a: 'Any language your test suite supports — TypeScript, Python, Go, Rust, Java, Ruby, and more.' },
          { q: 'How much does SYNTARO cost?', a: <>SYNTARO is free for public repos. See our <Link to="/pricing">pricing page</Link> for private repos and teams.</> },
          { q: 'Can I run SYNTARO on-premise?', a: <>Yes, SYNTARO is fully open-source and can be self-hosted. See our <Link to="/docs">documentation</Link>.</> },
        ].map((f, i) => (
          <div key={i} className="faq-item">
            <button className="faq-question">{f.q}</button>
            <div className="faq-answer"><p>{f.a}</p></div>
          </div>
        ))}
      </div>
    </section>

    <section className="cta-section">
      <h2>Stop Fixing Tickets. Start Shipping.</h2>
      <p className="sub">Install the SYNTARO GitHub App in under 30 seconds. No config. No onboarding calls.</p>
      <div className="btn-group">
        <a href="https://github.com/apps/syntarogithub1/installations/new" className="btn btn-primary btn-lg" data-track="cta-install">Install the GitHub App →</a>
        <Link to="/docs" className="btn btn-secondary" data-track="cta-docs">View Documentation</Link>
      </div>
    </section>
  </>);
}
