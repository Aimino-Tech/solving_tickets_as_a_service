# Risk-Register — App Marketplace Arbitrage

**Ticket:** AIM-4684 · **Stand:** 2026-08-06 · **Review-Zyklus:** wöchentlich (jeden Freitag im W-Wochen-Review), bei Launch neuer Apps sofort.

---

## Bewertungsskala

| Dimension | Werte |
| -- | -- |
| Schwere | Hoch = bedroht €100k-Ziel oder Existenz · Mittel = bedroht 1 App/Woche · Niedrig = kosmetisch |
| Eintrittswahrscheinlichkeit | Hoch / Mittel / Niedrig |
| Status | Offen · In Mitigation · Überwacht · Geschlossen |

---

## Risiken

| # | Risiko | Schwere | Eintritt | Auswirkung | Mitigation | Owner | Status |
| -- | -- | -- | -- | -- | -- | -- | -- |
| R1 | **Marketplace-ToS: Klonen / Review-Manipulation → Suspension** | Hoch | Mittel | Verlust des Zugangs zum Hauptkanal (Shopify/HubSpot), Umsatzausfall | Keine Assets/Namen/Texte/Screenshots des Marktführers kopieren; USP = „Top-Beschwerden gelöst" statt „Kopie"; keine Fake-Reviews (nur echte Beta-Nutzer); Legal-Check vor jedem Listing (G6 der Scoring-Matrix) | Legal + Product | Offen |
| R2 | **AppExchange Security Review (6–9 Wochen, $999/Attempt)** | Mittel | Hoch | App D kann in W4 nicht öffentlich gelistet werden | Direct-Sales/Custom-Installs vor Listing; Security-Review-Submission in W0; 2 Attempts im Budget ($1.998) eingeplant | Technical | In Mitigation |
| R3 | **Shopify/HubSpot App-Review-Ablehnung oder -Verzögerung** | Mittel | Mittel | Launch verzögert sich, W1/W3-Ziele rutschen | App A/B bereits W0–Tag 4 einreichen; Antwortzeit < 24h auf Reviewer-Fragen; Compliance-Check in der 48h-Pipeline (h40–h48) als Standard-Gate | Technical | Offen |
| R4 | **48h-Qualität reicht nicht (Sync, Edge-Cases)** | Hoch | Mittel | Negative Reviews, Refunds, Churn → Ziel verfehlt | MVP = Top-3-Beschwerden (kein Feature-Bloat); Beta-Test mit Community-Reviewern; „Fix-it-fast"-SLA in W1; AGI-Triage für Support-Tickets | Product | Offen |
| R5 | **Konkurrenz reagiert (Preissenkung, Feature-Parität)** | Mittel | Mittel | Preisvorteil schmilzt | Geschwindigkeit + Portfolio (nicht von 1 App abhängig); Preis nur einer von mehreren USPs (Sync-Qualität, Support, Migrations-Hilfe); laufendes Review-Monitoring | Product | Überwacht |
| R6 | **Support-Last unterschätzt** | Mittel | Mittel | SLA < 24h verletzt, negative Reviews, De-Listing-Risiko (Slack), Churn | Ticket-Triage mit AGI (Cluster + Vorlagenantwort); nur Apps mit einfacher Support-Oberfläche; 30-Tage-Geld-zurück als Puffer; Support-Budget ~$800/Woche eingeplant | Support | Offen |
| R7 | **Churn/Refunds nach Jahresvorauszahlung** | Mittel | Mittel | Umsatz-Defizit (Refunds kürzen kumulierten Umsatz) | 30-Tage-Geld-zurück; Fokus auf Anker-Funktion; Upgrade-Kampagnen statt Feature-Spreu; Refund-Quote als KPI überwachen (< 5%) | Product | Überwacht |
| R8 | **Wechselkurs-Risiko EUR/USD** | Niedrig | Mittel | €100k-Ziel sensitiv auf FX (Szenario FX 1.16 → €109k, noch ok; FX 1.00 + 70% Units → €98,8k) | Sensitivitäts-Sheet im Finanzmodell; Preisgestaltung in USD, Ziel-Review mit aktuellem FX; Gegensteuer-Maßnahmen bei Gap | Finance | Überwacht |
| R9 | **CAC ist doch nicht 0 (Listing-Keywords, Store-SEO)** | Mittel | Mittel | Zusätzliche Kosten, geringere Conversion | Store-SEO (Titel, Keywords, Screenshots) als fester Listing-Schritt; A/B-Tests W1–W2; Launch-Community als organischer Booster | Marketing | Offen |
| R10 | **Datenschutz/Compliance (EU): GDPR, Datenverarbeitung** | Mittel | Niedrig | Bußgeld, De-Listing, Vertrauensverlust | Privacy Policy + ToS online vor jedem Listing; Datenverarbeitung auf EU-Hosting dokumentieren; minimaler Scope-Bedarf (nur nötige API-Scopes); Reverse-Charge-MwSt korrekt | Legal | Offen |
| R11 | **Billing/Steuer-Komplexität (MwSt EU, Reverse-Charge)** | Mittel | Niedrig | Fehlbuchungen, Compliance-Aufwand | B2B Reverse-Charge (0% MwSt) als Standard; B2C-MwSt (DE 19%) als Pass-through; Billing über Store-Billing-APIs (Shopify App Pricing) statt Eigenabwicklung wo möglich | Finance | Offen |
| R12 | **Enterprise-Deals (App D) kommen nicht zustande** | Hoch | Mittel | ~€31,5k Lücke → €100k-Ziel gefährdet | 30 Kontakte ab W0; Migrations-Angebot; Demo bereit ab W2; Fallback: 5. Shopify-App (App E) hochziehen, Portfolio-Mix verschieben | Sales | Offen |

---

## Top-3-Mitigations (Priorität)

1. **R1 (ToS/Suspension):** Legal-Gate G6 in der Scoring-Matrix ist Pflicht, kein optionaler Schritt. Jede App
   bekommt vor dem Build eine Marken-/Asset-Prüfung.
2. **R2 (AppExchange):** Security-Review-Submission in W0 anstoßen; Umsatz über Direct Sales sicherstellen —
   nicht auf das öffentliche Listing warten.
3. **R4/R6 (Qualität/Support):** „Top-3-Beschwerden in v1" als Build-Prinzip + AGI-Support-Triage.
   Qualität ist der einzige nachhaltige Vorteil gegen Konkurrenzreaktion (R5).

---

## Eskalationspfad

- **Wochen-Review (Fr):** alle offenen Risiken prüfen, Status aktualisieren, neue Risiken aufnehmen.
- **Ziel-Verfehlungs-Risiko (R12, R4):** Gap-Analyse gegen Finanzmodell; bei < 85% des Wochenziels am
  Donnerstag → Szenario-Review und sofortige Gegensteuerung (Pricing, Pipeline, Portfolio-Verschiebung).
- **Suspension/Security-Vorfall (R1/R10):** sofortige Eskalation, Store-Support kontaktieren, Ausweichkanal
  (Direct Sales) aktivieren.
