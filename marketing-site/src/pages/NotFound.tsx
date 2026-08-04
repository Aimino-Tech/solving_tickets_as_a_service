import { Link } from 'react-router-dom';
import { useEffect } from 'react';
export default function NotFound() {
  useEffect(() => { document.title = '404 — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120, textAlign: 'center' }}>
      <h2>404 — Page Not Found</h2>
      <p className="sub">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn btn-primary" style={{ marginTop: 24 }}>Go Home</Link>
    </section>
  );
}
