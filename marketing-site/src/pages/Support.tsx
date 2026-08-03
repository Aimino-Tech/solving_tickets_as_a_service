import { useEffect } from 'react';

export default function Support() {
  useEffect(() => { document.title = 'Support — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Support</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
