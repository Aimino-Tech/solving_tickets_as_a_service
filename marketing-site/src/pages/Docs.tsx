import { useEffect } from 'react';

export default function Docs() {
  useEffect(() => { document.title = 'Docs — STAS'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Docs</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
