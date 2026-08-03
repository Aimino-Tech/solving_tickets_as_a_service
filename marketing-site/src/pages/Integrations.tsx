import { useEffect } from 'react';

export default function Integrations() {
  useEffect(() => { document.title = 'Integrations — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Integrations</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
