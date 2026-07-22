import { Link } from 'react-router-dom';

export default function Nav() {
  return (
    <nav className="nav" role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="logo-icon">S</span> STAS
        </Link>
        <button className="nav-toggle" id="navToggle" aria-label="Toggle navigation menu" aria-expanded="false">☰</button>
        <ul className="nav-links" id="navLinks">
          <li><Link to="/">Home</Link></li>
          <li><Link to="/pricing">Pricing</Link></li>
          <li><Link to="/trust">Trust</Link></li>
          <li><Link to="/docs">Docs</Link></li>
          <li><Link to="/blog">Blog</Link></li>
          <li><Link to="/status">Status</Link></li>
          <li><a href="https://github.com/apps/stasgithub1/installations/new" className="nav-cta" data-track="nav-install">Install App →</a></li>
        </ul>
      </div>
    </nav>
  );
}
