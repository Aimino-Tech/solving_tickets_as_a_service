import { useEffect } from 'react';

export default function Status() {
  useEffect(() => { document.title = 'Status — SYNTARO'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Status</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
