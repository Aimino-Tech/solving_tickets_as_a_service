# KPI-Definition & Dashboard-Setup — App Marketplace Arbitrage

**Ticket:** AIM-4684 · **Stand:** 2026-08-06 · **Zweck:** ein Dashboard, das die €100k-Rampe täglich sichtbar macht und früh Gegensteuerung ermöglicht.

---

## 1. KPI-Übersicht

| KPI | Definition | Ziel | Messfrequenz | Datenquelle |
| -- | -- | -- | -- | -- |
| **Kumulierter Netto-Umsatz** | Σ Netto-Umsatz aller Apps (USD→EUR, nach Gebühren) | ≥ €100k bis W4 | täglich | Billing (Stripe/Shopify Billing), Finanzmodell-Abgleich |
| **MRR / ARR** | Monthly/Annual Recurring Revenue | MRR ≥ $8k/W4 · ARR ≥ $100k/W4 | wöchentlich | Billing |
| **Installs** | Anzahl Installationen (Trial) pro App | App A/B ≥ 1.000/Woche* | täglich | Store-APIs |
| **Trial→Paid-Conversion** | Paid-Installs ÷ Trial-Starts | ≥ 3% | wöchentlich | Billing + Store |
| **Time-to-First-Sale** | Tage von Listing-Live bis erste Zahlung | < 7 Tage pro App | pro App | Billing |
| **Churn / Refund-Quote** | (Stornierte + refundierte Jahresverträge) ÷ aktive | < 5% | wöchentlich | Billing |
| **Review-Score** | Ø-Sterne-Bewertung je App | ≥ 4,5★ | wöchentlich | Store-Reviews |
| **Support-Response** | Zeit bis erste Antwort auf Ticket | < 24h | täglich | Support-Tool |
| **Support-Tickets/100 Installs** | Ticket-Last relativ zur Basis | fallend | wöchentlich | Support-Tool |
| **# Apps live** | Anzahl veröffentlichter Apps | 3 (W2) → 5 (W4) | wöchentlich | Store |
| **Annual-Prepay-Quote** | Annual-Verträge ÷ alle bezahlten Verträge | ≥ 50% | wöchentlich | Billing |
| **Setup-Fee-Einnahmen** | Σ Migrations-/Setup-Fees | ≥ $15k bis W4 | wöchentlich | Billing |
| **Enterprise-Deals (App D)** | Anzahl geschlossener Deals | 8 bis W4 | wöchentlich | CRM |

\* Abgeleitet aus dem Finanzmodell (Weekly-Ramp): App A erreicht 30–65 neue **Paid-Kunden** pro Woche.
   Bei der Ziel-Conversion von ≥ 3% (Trial→Paid) sind dafür **~1.000–2.200 Trial-Installs pro Woche** nötig
   (Berechnung: Paid/Woche ÷ 3%). Der Zielwert ≥ 1.000 ist die Untergrenze; W4-Spitzen (65 paid) erfordern
   bis zu ~2.200 Installs. Wird die Conversion-Grenze als erfüllt gemessen, die Install-Untergrenze aber
   unterschritten, sind Listing-/SEO- und Onboarding-Maßnahmen zu prüfen.

---

## 2. Dashboard-Setup

### 2.1 Tool-Struktur

| Ebene | Tool | Inhalt |
| -- | -- | -- |
| Realtime | Store-Dashboards (Shopify Partner, HubSpot, AppExchange) | Installs, Reviews, Listing-Status |
| Billing | Stripe / Shopify Billing API | MRR, ARR, Refunds, Setup-Fees, Kum. Netto |
| Support | Support-Inbox + AGI-Triage | Ticket-Volumen, Response-Time, Themen-Cluster |
| Sales | CRM (Pipeline App D) | Deals, Deal-Value, Stage |
| **Aggregation** | **Tabelle/Sheet (wöchentlich aktualisiert)** | alle KPIs je App, Trend, Ziel-Abweichung |

### 2.2 Dashboard-Layout (eine Übersichtsseite)

```
+--------------------------------------------------------------+
| Marketplace Arbitrage — Woche 3                              |
| Kum. Netto: €74,2k / €100k (74%)   ▓▓▓▓▓▓▓░░░░░   Trend: ✓  |
+--------------------------------------------------------------+
| App    | Live | Installs | Conv | MRR | Reviews | Setup | Net |
| A      |  ✓   |   150    | 3,4% |     |  4,6★   |       |     |
| B      |  ✓   |   120    | 3,1% |     |  4,5★   |       |     |
| C      |  ✓   |    45    | 2,8% |     |  4,4★   |       |     |
| D      |  ✓*  |     5    |  —   |     |   —     |  ✓    |     |
| E      |      |   build  |      |     |         |       |     |
+--------------------------------------------------------------+
| Warnungen: Refund-Quote App B 6,1% (Ziel <5%) | Support 22h |
+--------------------------------------------------------------+
```

\* App D = Enterprise-Deals (Direct Sales), nicht öffentliches Listing.

### 2.3 Ampel-Logik (automatische Warnung)

| KPI | Grün | Gelb | Rot |
| -- | -- | -- | -- |
| Kum. Netto vs. Wochenziel | ≥ 100% | 85–99% | < 85% |
| Trial→Paid | ≥ 3% | 1,5–3% | < 1,5% |
| Review-Score | ≥ 4,5★ | 4,0–4,4★ | < 4,0★ |
| Refund-Quote | < 3% | 3–5% | > 5% |
| Support-Response | < 12h | 12–24h | > 24h |

**Regel:** Zwei gelbe oder eine rote Ampel → Aktion im Rahmen des Wochen-Reviews (Fr); bei roter Ampel
für Kum. Netto zusätzlich Szenario-Review gegen das Finanzmodell.

---

## 3. Datenmodell (je App, wöchentlich)

```
app_id | store | week | installs_cum | trial_starts | paid_installs |
trial_conv_pct | mrr_usd | arr_usd | setup_fees_usd | refunds_usd |
reviews_count | review_score | tickets | first_response_h |
```

Wird wöchentlich aus Store/Billing/Support aggregiert und mit dem Finanzmodell (Portfolio-Sheet)
abgeglichen. Dient als Grundlage für die Gap-Analyse zur €100k-Rampe.

---

## 4. Review-Cadence

| Rhythmus | Zweck |
| -- | -- |
| Täglich (10 Min.) | Kum. Netto, Installs, Support-SLA, Reviews checken |
| Wöchentlich (Fr, 60 Min.) | Alle KPIs, Risk-Register-Review, Szenario-Vergleich, Gegensteuer-Maßnahmen |
| Nach Launch einer neuen App (sofort) | Time-to-First-Sale, Trial→Paid, erste Reviews |

---

## 5. Ziel-Decomposition (aus Finanzmodell, Base Case)

| Woche | Kum. Netto (EUR) | App-Fokus |
| -- | -- | -- |
| W1 | ~13,8k | A+B live |
| W2 | ~41,2k | +C live |
| W3 | ~74,2k | +D Deals, E im Build |
| W4 | **~117,1k** | +E live, Deals schließen |

KPIs sind so gewählt, dass jede Abweichung auf eine **steuerbare Ursache** zurückführbar ist
(Conversion, Pipeline, Support, Reviews) — nicht auf einen undurchsichtigen Gesamt-Delta.
