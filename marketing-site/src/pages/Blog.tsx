import { useEffect } from 'react';

export default function Blog() {
  useEffect(() => { document.title = 'Blog — STAS'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <h2>Blog</h2>
        <p className="sub">Coming soon.</p>
      </div>
    </section>
  );
}
