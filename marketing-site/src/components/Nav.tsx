import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function Nav() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleMobile = () => {
    const el = document.getElementById('navLinks');
    const btn = document.getElementById('navToggle');
    if (el && btn) {
      const open = el.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    }
  };

  const anchorNav = (
    <ul className="nav-anchors" id="navAnchors">
      <li><a href="#how-it-works">How It Works</a></li>
      <li><a href="#trust">Trust</a></li>
      <li><a href="#faq">FAQ</a></li>
    </ul>
  );

  return (
    <nav className={`nav${scrolled ? ' nav-scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="logo-icon">S</span> SYNTARO
        </Link>
        <button className="nav-toggle" id="navToggle" onClick={toggleMobile} aria-label="Toggle navigation menu" aria-expanded="false">☰</button>
        <ul className="nav-links" id="navLinks">
          <li><Link to="/">Home</Link></li>
          <li><Link to="/pricing">Pricing</Link></li>
          <li><Link to="/docs">Docs</Link></li>
          <li><a href="https://github.com/apps/syntarogithub1/installations/new" className="nav-cta" data-track="nav-install">Install App →</a></li>
        </ul>
      </div>
      {isHome && (
        <div className={`nav-anchor-bar${scrolled ? ' nav-anchor-bar--visible' : ''}`}>
          <div className="nav-inner">
            {anchorNav}
          </div>
        </div>
      )}
    </nav>
  );
}
