# 4-Wochen-Execution-Calendar — App Marketplace Arbitrage

**Ticket:** AIM-4684 · **Stand:** 2026-08-06 · **Horizont:** W0 (Pre-Launch) + W1–W4 (Launch)
Ziel: kumulierter Netto-Umsatz ≥ EUR 100.000 bis Ende W4.

> Alle Tage als Werktage (Mo–Fr) angenommen. Review-Fristen der Stores sind eingeplant:
> Shopify 5–10 Werktage, HubSpot 2–4 Wochen, AppExchange/Slack als Parallel-Pipeline (> W4).

---

## W0 — Pre-Launch (Tag -7 … -1)

### Tag -7 (Mo)
- [ ] Scraper-Framework aufsetzen (Shopify App Store Reviews via öffentliche Seite/API; HubSpot vorbereiten)
- [ ] AGI-Review-Analyse-Pipeline anschließen (Cluster von 1–3★-Reviews)
- [ ] Scoring-Matrix mit 8–10 Kandidaten füllen → 3 Kandidaten für Build auswählen (App A, B, E-Kandidat)
- [ ] Shopify Partner-Account registrieren ($19) + Entwicklungs-Umgebung (App-Billing, OAuth) anlegen

### Tag -6 (Di)
- [ ] **App A (Sync-Fix)** Build starten (h0: Scrape + Top-3-Reparaturen + Spezifikation)
- [ ] **App B (Price-Alternative)** Build starten (h0)
- [ ] HubSpot Developer-Account + OAuth-App anlegen (3-Installs-Voraussetzung vorbereiten)

### Tag -5 (Mi)
- [ ] App A: Integration + Billing (Shopify Billing API, Annual-Prepay) fertigstellen (h4–h40)
- [ ] App B: Integration + Billing fertigstellen
- [ ] Legal-Check starten: Marken-/Asset-Konfliktprüfung für App A/B/Namen (extern, 2–3h)

### Tag -4 (Do)
- [ ] App A: QA-Gate (h40–h48): OAuth, Billing, Sync-Edge-Cases, Listing-Assets (Screenshots, Beschreibung)
- [ ] App B: QA-Gate
- [ ] **App A + B bei Shopify App Store einreichen** (Review 5–10 Werktage → Publish ~W1)
- [ ] Support-Setup (Ticket-Inbox + AGI-Triage-Vorlage), Privacy Policy + ToS-Seiten online

### Tag -3 (Fr)
- [ ] **App C (HubSpot Gap)** Build starten (h0–h4)
- [ ] HubSpot-3-Installs sichern (Beta-Partner/Community-Installs, echte Konten)
- [ ] AppExchange Partner-Account registrieren; Security-Review-Queue **sofort** anstoßen (längste Vorlaufzeit)
- [ ] Enterprise-Prospecting-Liste App D (30 Zielkonten mit dokumentiertem Sync-Problem)

### Tag -2 / -1 (Wochenende)
- [ ] App C Build fortsetzen (h4–h40)
- [ ] Listing-Assets App C
- [ ] First-Sales-Vorbereitung: Launch-Announcement, Beta-Community (Seed-Reviewer, echte Nutzer)

**W0-Exit-Kriterium:** App A+B submitted, App C im Build, HubSpot-3-Installs gesichert, AppExchange-Pipeline offen.

---

## W1 — Launch A + B (Tag 1–5)

### Tag 1 (Mo)
- [ ] Shopify-Review-Status prüfen; ggf. Reviewer-Fragen beantworten (schnelle Antwort = schnellere Freigabe)
- [ ] Beta-Community-Launch vorbereiten (echte Nutzer, keine Fake-Reviews)
- [ ] KPI-Dashboard (siehe `kpi-dashboard.md`) mit Install-/Revenue-Tracking live schalten

### Tag 2 (Di)
- [ ] **App A live** (bei Freigabe) — Veröffentlichung, Support-SLA < 24h
- [ ] **App B live** — Veröffentlichung
- [ ] Erste Seed-Reviews von echten Beta-Nutzern

### Tag 3 (Mi)
- [ ] **First Sales Review:** Time-to-First-Sale, Conversion Trial→Paid messen
- [ ] Feedback-Loop: neue Reviews/Tickets als AGI-Analyse (nächste Feature-Runde)

### Tag 4 (Do)
- [ ] Preis-/Listing-Tests starten (A/B: Preisleiter vs. Feature-Leader)
- [ ] App C Build abschließen → QA

### Tag 5 (Fr)
- [ ] **App C bei HubSpot Marketplace einreichen** (Review 2–4 Wochen → Publish ~W3)
- [ ] Enterprise-Prospecting App D: erste 10 Outreach-Nachrichten raus
- [ ] **Wochen-Review:** kum. Netto ≥ ~€13,8k, Learning-Session

**W1-Exit-Kriterium:** App A+B live mit First-Sales, App C submitted, erste Reviews vorhanden.

---

## W2 — Launch C + Optimierung (Tag 6–10)

### Tag 6 (Mo)
- [ ] Trial→Paid-Optimierung: Onboarding-Flow, Erfolgs-Events, Trial-Länge testen
- [ ] App A/B Optimierungsrunde 1 (Top-Ticket nach Fix-it-fast-SLA)

### Tag 7 (Di)
- [ ] HubSpot-Review-Status prüfen; Rückfragen beantworten
- [ ] App E (Shopify Sekundär) Build starten (h0)

### Tag 8 (Mi)
- [ ] **App C live** (falls Freigabe) — Veröffentlichung HubSpot
- [ ] Enterprise-Verkaufsgespräche App D (Demo-Termine, Migrations-Angebote)

### Tag 9 (Do)
- [ ] App E Build fortsetzen
- [ ] Annual-Upgrade-Kampagne App A/B (Free→Paid, Monthly→Annual mit 20% Rabatt)

### Tag 10 (Fr)
- [ ] **Wochen-Review:** kum. Netto ≥ ~€41,2k, Conversion-Auswertung
- [ ] AppExchange-Security-Review-Status prüfen (Queue bestätigt)

**W2-Exit-Kriterium:** App C live (oder im Review), Enterprise-Pipeline mit Terminen, App E im Build.

---

## W3 — Launch D (Direct) + App E (Tag 11–15)

### Tag 11 (Mo)
- [ ] **App D Enterprise-Deals:** erste 2 Deals closen (Custom Install / Direct Billing, Migrations-Setup)
- [ ] App E Build abschließen → QA

### Tag 12 (Di)
- [ ] App E QA-Gate + Listing-Assets
- [ ] Enterprise-Deal #3 verhandeln

### Tag 13 (Mi)
- [ ] **App E bei Shopify einreichen** (Review → Publish ~W4)
- [ ] App C Launch-Boost: HubSpot-Community, Reviews sammeln

### Tag 14 (Do)
- [ ] Enterprise-Deal #4–5 verhandeln
- [ ] Upgrade-Kampagne Runde 2 (Churn-Risiko-Kontakte, 30-Tage-Geld-zurück kommunizieren)

### Tag 15 (Fr)
- [ ] **Wochen-Review:** kum. Netto ≥ ~€74,2k
- [ ] Forecast W4: Gap-Analyse zum €100k-Ziel; ggf. Pricing-/Unit-Anpassung

**W3-Exit-Kriterium:** 2–5 Enterprise-Deals in Pipeline, App E submitted, Gap-Analyse dokumentiert.

---

## W4 — Launch E + Deals schließen (Tag 16–20)

### Tag 16 (Mo)
- [ ] **App E live** (bei Freigabe)
- [ ] Enterprise-Deals weiterclosen (Ziel: 8 kum.)

### Tag 17 (Di)
- [ ] Closing-Push: alle offenen Enterprise-Termine → Angebote mit Migrations-Support
- [ ] Annual-Deal-Schlusskampagne App A/B/C (Deadline-Effekt für Jahresverträge)

### Tag 18 (Mi)
- [ ] AppExchange-Security-Review abgeschlossen? → Listing-Submission vorbereiten (W5-Start)
- [ ] Überweisungseingänge prüfen, Refund-Risiko managen (30-Tage-Geld-zurück)

### Tag 19 (Do)
- [ ] Letzte Enterprise-Angebote versenden
- [ ] Portfolio-Gesamtschau: welche App liefert, welche nicht → W5-Budget-Allokation

### Tag 20 (Fr)
- [ ] **Ziel-Review: kum. Netto ≥ EUR 100k?** Auswertung gegen Finanzmodell (Szenarien)
- [ ] Post-Launch-Plan: AppExchange-Listing (W5), Slack-Pipeline (W6+), Portfolio-Erweiterung
- [ ] KPI-Report W1–W4 erstellen, Learnings dokumentieren

---

## Kritischer Pfad (Risiko-Tracking)

| Abhängigkeit | Engpass | Risiko-Mitigation |
| -- | -- | -- |
| Shopify-Review (App A/B) | 5–10 Werktage | Sofort einreichen (W0–Tag 4); Antwortzeit < 24h |
| HubSpot-3-Installs | Vor Review nötig | Bereits W0–W1 sichern |
| HubSpot-Review | 2–4 Wochen | Einreichung W1–Tag 5; Publish ~W3 |
| AppExchange Security Review | 6–9 Wochen | W0 anstoßen; Umsatz über Direct Sales vor Listing |
| Enterprise-Deals | Sales-Zyklus | 30 Kontakte, Migrations-Angebot, Demo bereit ab W2 |
| App E Freigabe | Shopify-Review | W3–Tag 13 einreichen → Publish ~W4 |

---

## Rechenbeispiel der Wochenziele (aus Finanzmodell)

Wochenziele basieren auf dem Base-Case-Szenario (`financial-model.xlsx`, Sheet „Weekly Ramp"):

| Woche | Neue Kunden (alle Apps) | Kum. Netto (EUR) |
| -- | -- | -- |
| W1 | 66 | ~13,8k |
| W2 | 124 | ~41,2k |
| W3 | 150 | ~74,2k |
| W4 | 178 | **~117,1k** |

Abweichung von ≥ 15% in zwei aufeinanderfolgenden Wochen löst ein Szenario-Review aus
(Pessimistisch 70% Units ≈ €91,4k → Gegensteuern: Pricing, Upgrade-Kampagnen, Enterprise-Pipeline).
