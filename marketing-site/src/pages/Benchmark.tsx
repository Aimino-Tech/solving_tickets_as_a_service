import { useEffect } from 'react';
export default function Benchmark() {
  useEffect(() => { document.title = 'Benchmarks — STAS'; }, []);
  return (
    <section className="section" style={{ paddingTop: 120 }}>
      <div className="section-header">
        <div className="label">Benchmarks</div>
        <h2>How STAS Compares</h2>
        <p className="sub">Real data from the XOR benchmark.</p>
      </div>
    </section>
  );
}
