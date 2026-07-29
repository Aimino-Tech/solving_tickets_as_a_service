import { useEffect } from 'react';

export default function Agents() {
  useEffect(() => { document.title = 'Agents — STAS'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Agents</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
