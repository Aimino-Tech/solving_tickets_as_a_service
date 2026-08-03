import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function PricingSuccess() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const sessionId = params.get('session_id');

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      return;
    }

    fetch(`/api/v1/billing/verify-checkout?session_id=${sessionId}`)
      .then((res) => {
        if (res.ok) setStatus('success');
        else setStatus('error');
      })
      .catch(() => setStatus('error'));
  }, [sessionId]);

  return (
    <section className="section" style={{ paddingTop: 120, textAlign: 'center' }}>
      {status === 'verifying' && (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <h2>Verifying Your Subscription...</h2>
          <p className="sub">Please wait while we confirm your payment.</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h2>Subscription Active!</h2>
          <p className="sub">Your SYNTARO subscription is now active. Install the GitHub App to get started.</p>
          <div className="btn-group" style={{ justifyContent: 'center', marginTop: 32 }}>
            <a href="https://github.com/apps/syntarogithub1/installations/new" className="btn btn-primary btn-lg">Install GitHub App →</a>
            <Link to="/docs" className="btn btn-secondary">Read the Docs</Link>
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
          <h2>Something Went Wrong</h2>
          <p className="sub">We couldn't verify your payment. Please contact support@aimino.io if the issue persists.</p>
          <div className="btn-group" style={{ justifyContent: 'center', marginTop: 32 }}>
            <Link to="/pricing" className="btn btn-primary">Back to Pricing</Link>
            <a href="mailto:support@aimino.io" className="btn btn-secondary">Contact Support</a>
          </div>
        </>
      )}
    </section>
  );
}
