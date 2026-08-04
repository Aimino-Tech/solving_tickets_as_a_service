import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="nav-logo" style={{ marginBottom: 8 } as React.CSSProperties}><span className="logo-icon">S</span> SYNTARO</Link>
          <p>Solving Tickets As A Service. An open-source project by <a href="https://aimino.io">AImino</a>. Backed by OpenCode.</p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><Link to="/pricing">Pricing</Link></li>
            <li><Link to="/trust">Trust & Security</Link></li>
            <li><Link to="/integrations">Integrations</Link></li>
            <li><Link to="/benchmarks">Benchmarks</Link></li>
            <li><Link to="/agents">Agents</Link></li>
          </ul>
        </div>
        <div>
          <h4>Resources</h4>
          <ul>
            <li><Link to="/docs">Documentation</Link></li>
            <li><Link to="/blog">Blog</Link></li>
            <li><Link to="/status">Status</Link></li>
            <li><Link to="/support">Support</Link></li>
            <li><Link to="/faq">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><a href="https://aimino.io">About AImino</a></li>
            <li><a href="mailto:contact@aimino.io">Contact</a></li>
            <li><Link to="/impressum">Impressum</Link></li>
          </ul>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><Link to="/privacy">Privacy Policy</Link></li>
            <li><Link to="/terms">Terms of Service</Link></li>
            <li><Link to="/dpa">Data Processing Agreement</Link></li>
          </ul>
        </div>
        <div>
          <h4>Community</h4>
          <ul>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service">GitHub</a></li>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues">Issues</a></li>
            <li><a href="https://github.com/marketplace/actions/syntaro-eval">Marketplace</a></li>
          </ul>
        </div>
        <div>
          <h4>MCP</h4>
          <ul>
            <li><Link to="/docs#mcp">MCP Protocol</Link></li>
            <li><a href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/AGENTS.md">Agent Setup</a></li>
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
