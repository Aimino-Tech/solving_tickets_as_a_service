export function AuditLogPage() {
  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Audit Log</h2>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
        <p style={{ color: '#718096', marginBottom: 16 }}>Timeline of all actions performed by the bot.</p>
        <p style={{ color: '#a0aec0', fontSize: 14 }}>
          Audit log requires the database audit persistence feature to be enabled.
        </p>
      </div>
    </div>
  );
}
