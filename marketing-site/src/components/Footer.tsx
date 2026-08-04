import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="nav-logo" style={{ marginBottom: 8 } as React.CSSProperties}><span className="logo-icon">S</span> SYNTARO</Link>
          <p>SYNTARO. An open-source project by <a href="https://aimino.io">AImino</a>. Backed by OpenCode.</p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><Link to="/pricing">Pricing</Link></li>
            <li><Link to="/docs">Documentation</Link></li>
            <li><Link to="/trust">Trust & Security</Link></li>
            <li><Link to="/status">Status</Link></li>
            <li><Link to="/support">Support</Link></li>
          </ul>
        </div>
        <div>
          <h4>Community</h4>
          <ul>
            <li><Link to="/blog">Blog</Link></li>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service">GitHub</a></li>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues">Issues</a></li>
            <li><a href="https://github.com/marketplace/actions/syntaro-eval">Marketplace</a></li>
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><a href="https://aimino.io">AImino</a></li>
            <li><a href="https://opencode.ai">OpenCode</a></li>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/LICENSE">License</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; 2026 AImino. All rights reserved.</span>
        <a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service">Open Source (MIT)</a>
      </div>
    </footer>
  );
}
