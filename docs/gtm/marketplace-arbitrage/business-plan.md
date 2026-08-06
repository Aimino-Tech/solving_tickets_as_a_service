# GTM | App Marketplace Arbitrage — Businessplan

**Ticket:** AIM-4684 · **Stand:** 2026-08-06 · **Ziel:** kumulierter Umsatz ≥ **EUR 100.000** in den ersten 4 Wochen nach Launch (W4)

> Kumulierter Umsatz = Netto-Umsatz (nach Marketplace-Gebühren), über alle Apps summiert, bis Ende W4.
> Wechselkurs-Effekt, MwSt und Gebühren sind im Finanzmodell berücksichtigt (`financial-model.xlsx`).

---

## 1. Zusammenfassung (Executive Summary)

App-Marketplaces (Shopify App Store, HubSpot Marketplace, Salesforce AppExchange) betreiben **eingebaute Nachfrage**:
Nutzer suchen dort explizit nach einer Lösung für ein dokumentiertes Problem. Tausende zahlende Nutzer einer
etablierten App, kombiniert mit wiederkehrenden 1–3-Sterne-Beschwerden (Preis, Sync-Ausfälle, Support), sind
ein **validierter Product-Market-Fit-Shortcut**: Das Problem existiert, die Zahlungsbereitschaft ist bewiesen,
die Customer Acquisition übernimmt der Store (CAC ≈ 0).

Das Modell **App Marketplace Arbitrage**:

1. Reviews der Top-Apps pro Kategorie scrappen (1–3★, tausende Nutzer)
2. Wiederkehrende Beschwerde-Muster clustern (AGI): Preis, Sync, Support, fehlendes Feature
3. Innerhalb von **48h** eine bessere 1:1-Alternative bauen (Top-3-Beschwerden gefixt)
4. Direkt neben dem Marktführer listen — niedrigerer Preis und/oder besseres Feature-Set
5. Der Marketplace liefert die Nachfrage; CAC ≈ 0; der Kaufanreiz ist durch die Preis-/Ratings-Nebeneinander-Anzeige eingebaut

**Diese Recherche (2026-08-06) bestätigt die Grundthese und korrigiert zwei Annahmen:**

| Befund | Auswirkung |
| -- | -- |
| Shopify: **0% RevShare** auf die ersten $1M (seit 2025), 2,9% Processing, Review 5–10 Werktage | Shopify ist der schnellste und günstigste Weg in den Markt → **W1-Start** |
| HubSpot: **$0 Listing-Fee, 0% RevShare**, aber **3 Installationen vor Review** + 2–4 Wochen Review | HubSpot passt, aber Listing erst ab ~W2 möglich |
| AppExchange: **Security Review $999/Attempt, 6–9 Wochen Warteschlange** | Öffentliches Listing **nicht in 4 Wochen** möglich → **Enterprise-Deals vor Listing über Direct Sales**, Listing-Pipeline parallel anstoßen |
| Slack: Review ≤10 Werktage preliminar + **bis 10 Wochen funktional** | Für 4-Wochen-Horizont **nicht nutzbar** → Opportunity-Score senken |

Die ursprüngliche Portfolio-Skizze (4 Apps, ~$99,5k) unterschreitet das €100k-Ziel knapp (~€92k netto).
**Schließung der Lücke: 5. App (Shopify-Sekundär-App) + Setup-/Migrations-Fees + Annual-Prepay-Mix.**

---

## 2. Markt & Nachfrage (Warum das funktioniert)

### 2.1 Eingebaute Nachfrage

- **Shopify App Store:** >16.000 Apps, 2,5M+ Merchants; Nutzer suchen gezielt nach "X für Shopify".
- **HubSpot Marketplace:** ~2.000 Apps, 278.000+ Unternehmen im HubSpot-Ökosystem.
- **AppExchange:** ~6.000 Apps, Enterprise-Käufer, Ø höherpreisig.
- **Slack App Directory:** großes Ökosystem, aber Review-Zyklus schließt 4-Wochen-Launch aus.

### 2.2 Warum Reviews der Hebel sind

- 1–3★-Reviews sind **kostenlose, ehrliche Produkt-Roadmaps** der Konkurrenz.
- Wiederkehrende Muster („Sync bricht ab", „zu teuer", „Support antwortet nicht") = genau die
  Reparatur-Spezifikation, die der AGI-Build-Pipeline als Input dient.
- Der Marktführer kann nicht schnell reagieren (große Org, Feature-Roadmap in Quartalen);
  ein 48h-Agent baut und shipped in der Zeit, die ein Incumbent für ein Sprint-Planning-Meeting braucht.

### 2.3 Warum der Preisvergleich eingebaut ist

Marketplace-Listings ranken für dieselben Keywords und zeigen Preis + Rating **nebeneinander**.
Bei 30–50% günstigerem Preis (bei mindestens gleicher Kernfunktion) ist der Kaufanreiz im Listing selbst
verankert — kein eigenes Marketing nötig, kein CAC.

---

## 3. Strategie

### 3.1 Portfolio statt Single-Product-Wette

Ein einzelnes App-Produkt ist ein Binärrisiko. Das Portfolio streut über **3 Störe, 2 Pricing-Segmente
und 5 Apps**:

| Segment | Apps | Store | Rolle |
| -- | -- | -- | -- |
| SMB-Volumen (Annual $99–149) | App A, B, E | Shopify | Volumen, schnelle First-Sales, Review-Kompetenz |
| Mid-Market ($490) | App C | HubSpot | Höherer ACV, weniger Konkurrenz, 0% RevShare |
| Enterprise ($3.500) | App D | AppExchange (Direct Sales) | Größter Einzelbeitrag (~€26k) |

**Warum Portfolio:** Misserfolg einer App (Review-Ablehnung, Sync-Problem, kein Sales) kostet
1/5 des Umsatzpfads, nicht alles.

### 3.2 USP-Definition: "Top-Beschwerden gelöst" statt "Kopie"

**Nicht** Assets, Namen, Screenshots oder Texte des Marktführers übernehmen (ToS-Risiko, siehe Risk-Register).
Der USP ist **nicht** „gleiche App, billiger", sondern:

> „Die App, die die Top-3-Probleme der Nutzer der App X löst."

Konkretes Beispiel-Labeling pro App:
- App A: „Sync-Fix" — löst das am häufigsten genannte Sync-Ausfall-Muster
- App B: „Price-Alternative" — gleiche Kernfunktion, 40% günstiger
- App C: „Gap-Filler" — Funktionslücke, die die Marktführer offen lassen

### 3.3 Pricing-Strategie (Test & Lernschleife)

| Heuristik | Ansatz | Entscheidung |
| -- | -- | -- |
| Preisleiter (Start) | **30–50% unter Marktführer** bei gleicher Kernfunktion | Schnelle Conversion, First-Sales, Reviews sammeln |
| Feature-Leader (A/B) | gleicher Preis + besseres Feature-Set | Ab W2 A/B-Test auf App A/B |

**Mix für €100k zwingend:** Annual-Prepay (vollständig in W4 gebucht) + Setup-/Migrations-Fees + Enterprise-Deals.
Monatliche Subscriptions allein liefern in 4 Wochen zu wenige Abrechnungszyklen.

### 3.4 48h-Build-Pipeline (Produkt-Template)

| Phase | Zeit | Output |
| -- | -- | -- |
| Scrape & Analyse | h0–h4 | Review-Corpus, Top-3-Reparaturen, Spezifikation, Pricing/Listing-Assets |
| Build (AGI) | h4–h40 | App, OAuth/Integration, Billing (Stripe/Shopify Billing), Compliance-Check |
| QA & Listing | h40–h48 | QA, Listing-Submit, Support-Setup, Seed-Reviews (echte Beta-Nutzer) |

### 3.5 Ressourcen

| Rolle | Umfang | Verantwortung |
| -- | -- | -- |
| AGI-Pipeline | ~5 Apps × 48h | App-Generierung, Review-Analyse |
| Technical Reviewer | 1 Person, ~20h/Woche | AGI-Output prüfen (OAuth, Billing, Sicherheit), QA-Gate |
| Support (Triage) | 1 Person, ~10h/Woche + AGI-Triage | Tickets sortieren, SLA < 24h |
| Sales (Enterprise) | 1 Person, ~15h/Woche | AppExchange-Direct-Deals, Migrations-Angebote |
| Legal/Compliance | extern, 2–3h | ToS-Review, Marken-/Asset-Konfliktprüfung, Datenschutz |

---

## 4. Ziel-Portfolio (Base Case, W4)

| App | Store | Kunden (kum.) | Ø-Preis/Jahr | Sub-Umsatz | Setup-Fees | Netto (EUR) |
| -- | -- | -- | -- | -- | -- | -- |
| App A — Sync-Fix | Shopify | 200 | $99 | $19.800 | $3.920 | ~€21,4k |
| App B — Price-Alternative | Shopify | 150 | $149 | $22.350 | $3.555 | ~€23,4k |
| App C — HubSpot Gap | HubSpot | 60 | $490 | $29.400 | $4.470 | ~€30,6k |
| App D — Enterprise | AppExchange* | 8 | $3.500 | $28.000 | $6.000 | ~€31,5k |
| App E — Shopify Sekundär | Shopify | 100 | $99 | $9.900 | $1.470 | ~€10,3k |
| **Summe** | | | | **$109.450** | **$19.415** | **≈ €117.132** |

\* Enterprise-Deals über **Direct Sales / Custom Installs** (vor öffentlichem Listing); AppExchange-Listing-Pipeline
läuft parallel (6–9 Wochen Security Review). Bei vollständiger Abwicklung über AppExchange Checkout
(15% RevShare) sinkt App D um ~$5.100 (15% auf $34k Brutto) → Gesamt-Netto ≈ €112,4k (weiterhin über Ziel).

**Anmerkung MwSt:** B2B in EU i.d.R. Reverse-Charge (0%); B2C-Verkäufe DE unterliegen 19% MwSt
(im Modell nicht als Umsatz gebucht, sondern als Pass-through).

### 4.1 Unit Economics (Kernwerte)

| App | Netto/Kunde/Jahr | COGS/Kunde (Build-Anteil) | Netto-Marge |
| -- | -- | -- | -- |
| App A | ~$116 | $2,50 | ~98% |
| App C | ~$550 | $8,33 | ~97% |
| App D | ~$4.250 | $62,50 | ~100% |

COGS ist volumenunabhängig klein, weil Build-Kosten **einmalig pro App** anfallen und sich über die
Install-Basis amortisieren. Der dominante Kostenblock über 4 Wochen ist Support (~$800/Woche).

---

## 5. Launch-Plan (4 Wochen, Detail in `execution-calendar.md`)

| Woche | Fokus | Meilensteine | Kum. Netto (Ziel) |
| -- | -- | -- | -- |
| W0 (Pre-Launch) | Pipeline, Scouting, 2 Apps bauen | Scraper, Scoring von 8–10 Kandidaten, App A+B fertig + eingereicht, Billing/Listings, HubSpot-3-Installs vorbereiten | — |
| W1 | Launch A+B (Shopify) | **First Sales**, Reviews, Feedback-Loop, Preis-Tests | ~€13,8k |
| W2 | Launch C (HubSpot), Optimierung | App C live, Trial→Paid-Optimierung, Enterprise-Verkaufsgespräche | ~€41,2k |
| W3 | Launch D (Direct), App E Build | Enterprise-Deals (2–3), App E eingereicht, Upgrade-Kampagnen | ~€74,2k |
| W4 | Launch E, Deals schließen | App E live, Annual-Deals, Enterprise-Closing (bis 8), **Ziel-Review €100k** | **≥ €100k** |

> AppExchange- und Slack-Pipeline werden in W0 parallel angestoßen (Security-Review-Queue, Slack-Submission),
> damit ab W5/W6 weitere Umsatzströme anlaufen — außerhalb des 4-Wochen-Ziels, aber als Post-Launch-Treiber.

---

## 6. Offene Entscheidungen (mit Empfehlung)

| # | Entscheidung | Empfehlung | Begründung |
| -- | -- | -- | -- |
| 1 | Erster Store | **Shopify** | Höchster Traffic, 0% RevShare (erste $1M), Review 5–10 Werktage → schnellster Pfad zu First-Sales |
| 2 | Pricing-Heuristik | **30–50% unter Marktführer** (A/B ab W2) | Schnelle Conversion für die 4-Wochen-Rampe; Feature-Leader als A/B-Variante |
| 3 | Marke | **Dachmarke** „[App] by Aimino" | Vertrauen, ein Listing-Portfolio, Review-Reputation transferierbar |
| 4 | Ressourcen | siehe §3.5 | Technical Reviewer + Sales sind die kritischen Engpässe |
| 5 | Zieldefinition | **kumulierter Umsatz W4** (nicht MRR) | Einzig in 4 Wochen erreichbare Definition; MRR-Nachlauf dokumentieren |

---

## 7. Nächste Schritte (nach Abnahme)

1. Scoring-Matrix mit **echten Scraping-Daten** füttern (Top-20 Shopify + Top-10 HubSpot) → `opportunity-scoring-matrix.md`
2. 48h-Pipeline als **Produkt-Template** bauen (PoC an 1 Kandidat)
3. W0-Checklist abarbeiten → Launch-Woche festlegen
4. AppExchange-Partner-Account + Security-Review-Submission **sofort** (längste Vorlaufzeit)

---

## Anlagen

- `financial-model.xlsx` / `.csv` — Finanzmodell mit Sensitivitäten (FX, Units, Enterprise-RevShare)
- `opportunity-scoring-matrix.md` — gewichtete Kandidaten-Bewertung
- `execution-calendar.md` — tag-genaue Roadmap (W0–W4)
- `risk-register.md` — ToS, Compliance, Support, Konkurrenz
- `kpi-dashboard.md` — KPI-Definitionen und Dashboard-Setup
