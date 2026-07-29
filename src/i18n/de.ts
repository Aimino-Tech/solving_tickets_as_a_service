/**
 * German (DE) locale for STAS output messages.
 * Used for DACH market compliance and user-facing communications.
 */
export const de = {
  locale: 'de-DE',
  name: 'Deutsch',
  common: {
    loading: 'Wird geladen...',
    error: 'Ein Fehler ist aufgetreten',
    success: 'Erfolgreich',
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
    save: 'Speichern',
    delete: 'Löschen',
    search: 'Suchen',
    noResults: 'Keine Ergebnisse gefunden',
    yes: 'Ja',
    no: 'Nein',
    back: 'Zurück',
    next: 'Weiter',
    close: 'Schließen',
  },
  ticket: {
    created: 'Ticket erstellt',
    assigned: 'Ticket zugewiesen an {assignee}',
    fixInProgress: 'STAS arbeitet an der Fehlerbehebung...',
    fixComplete: 'Fehlerbehebung abgeschlossen — Pull-Request erstellt: {prUrl}',
    fixFailed: 'Fehlerbehebung fehlgeschlagen: {reason}',
    needsApproval: 'Ticket benötigt Freigabe vor der Ausführung',
    approvalRequired: 'Freigabe erforderlich',
    approved: 'Freigegeben von {approver}',
    rejected: 'Abgelehnt von {rejector}',
    pendingApproval: 'Ausstehende Freigabe',
  },
  audit: {
    exportStarted: 'Audit-Export gestartet',
    exportComplete: 'Audit-Export abgeschlossen: {count} Einträge',
    exportFailed: 'Audit-Export fehlgeschlagen: {reason}',
    retentionDays: 'Aufbewahrungsdauer: {days} Tage',
  },
  dach: {
    compliance: 'DSGVO-konform',
    dataResidency: 'Datenverbleib in der EU',
    hoster: 'Gehostet bei Hetzner (Deutschland)',
    hosterDescription: 'Alle Daten werden in deutschen Rechenzentren verarbeitet und gespeichert.',
    gdprCompliant: 'DSGVO-konform — Auftragsverarbeitungsvertrag verfügbar',
    industryCert: 'Industriezertifizierungen: ISO 27001, SOC 2 Typ II',
    approvalGate: 'Genehmigungs-Workflow für Tickets mit Auswirkungen auf Produktion',
  },
  time: {
    justNow: 'Gerade eben',
    minutesAgo: 'Vor {minutes} Minuten',
    hoursAgo: 'Vor {hours} Stunden',
    daysAgo: 'Vor {days} Tagen',
  },
  errors: {
    notFound: 'Ressource nicht gefunden',
    unauthorized: 'Nicht autorisiert',
    forbidden: 'Zugriff verweigert',
    validationError: 'Validierungsfehler',
    rateLimited: 'Zu viele Anfragen. Bitte später erneut versuchen.',
    approvalRequired: 'Dieser Vorgang erfordert eine Freigabe.',
    complianceBlock: 'Compliance-Prüfung fehlgeschlagen: {reason}',
  },
} as const;

export type DeMessages = typeof de;
