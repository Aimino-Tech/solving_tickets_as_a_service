# Opportunity-Scoring-Matrix — App Marketplace Arbitrage

**Ticket:** AIM-4684 · **Stand:** 2026-08-06 · **Zweck:** reproduzierbarer Filter, um die richtigen Apps zum Klonen auszuwählen.

---

## 1. Funktionsweise

1. **Harte Kriterien (Gate):** Jeder Kandidat muss **alle** harten Kriterien erfüllen — sonst Abbruch, keine Scoring-Punkte.
2. **Gewichtete Kriterien (Score):** Kandidaten, die das Gate passieren, erhalten 0–100 Punkte über gewichtete Kriterien.
3. **Cut-off:** Score ≥ 70 → Build-Pipeline; 55–69 → Watchlist; < 55 → verworfen.
4. **Max. gleichzeitige Apps:** 3 (2 Shopify + 1 HubSpot) in W0–W2, danach Erweiterung.

---

## 2. Harte Kriterien (Gate — alle müssen erfüllt sein)

| # | Kriterium | Messung | Quelle |
| -- | -- | -- | -- |
| G1 | ≥ 3 wiederkehrende Beschwerde-Muster in 1–3★-Reviews | Cluster-Analyse der Review-Texte (AGI) | Store-API / Scraper |
| G2 | Install-Basis ≥ 1.000 Nutzer (bewiesene Nachfrage) | Listing-Installs / Review-Volumen als Proxy | Store-Listing |
| G3 | Feature-Oberfläche in 48h klonbar | Keine Deep-Integrations, kein ML-Kern, keine Compliance-Kernfunktionen (Zahlung als PSP, medizinisch, etc.) | Technik-Review |
| G4 | Top-3-Beschwerden in v1 behebbar | Mapping Beschwerde → konkrete Feature-Änderung | Technik-Review |
| G5 | Store erlaubt Launch in ≤ 4 Wochen | Shopify/HubSpot ja; AppExchange nein (Listing-Pipeline separat); Slack nein | Store-Policy |
| G6 | Keine rechtlichen Red Flags | Kein Marken-/Asset-Konflikt, keine Review-Manipulation nötig | Legal-Check |

**Ausschluss-Klausel:** Ein Kandidat, dessen Kernfunktion eine unlautere Kopie des Marktführers wäre
(identische UI, kopierte Assets), scheitert an G6.

---

## 3. Gewichtete Kriterien (Score 0–100)

| Kriterium | Gewicht | 0 Punkte | 5 Punkte | 10 Punkte |
| -- | -- | -- | -- | -- |
| K1 Store-Traffic | 15% | Slack | AppExchange | Shopify / HubSpot |
| K2 Preisdifferenz zum Marktführer | 20% | < 10% | 10–30% | 30–50% |
| K3 Wechselkosten für Nutzer | 15% | hoch (Migration, Datensperre) | mittel | niedrig (Standard-API, Export) |
| K4 Beschwerde-Dichte | 20% | < 3 Muster | 3–5 Muster | > 5 Muster, bei Top-App (>5k Reviews) |
| K5 Build-Komplexität (48h) | 15% | hoch (3+ Integrationen) | mittel (1 Integration + UI) | niedrig (1 OAuth, CRUD) |
| K6 Annual-Prepay-Fähigkeit | 10% | nur monatlich | optional | Standard-Angebot |
| K7 Datenverfügbarkeit für Scrape | 5% | Reviews nicht zugreifbar | eingeschränkt | öffentlich via API/Seite |

**Score-Formel:** `Score = Σ (Kriterium-Punkte × Gewicht)`, Punkte je Kriterium auf 0–10 skaliert.

---

## 4. Pre-Fill-Scoring (Beispiel-Anwendung, aus Recherche abgeleitet)

Die Matrix wird in W0 mit **echten Scraping-Daten** gefüllt. Als Kalibrierung (nicht als Ersatz) sind hier
typische Kandidaten-Silhouetten bewertet:

| Kandidat | Gate | Store | Preisdiff | Wechselk. | Beschw.-Dichte | Build | Annual | Scrape | **Score** | Empfehlung |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| Sync-Fix für Shopify-Export | ✅ | Shopify | 8 | 8 | 9 | 7 | 9 | 9 | **8,2** | Build |
| Billige Preis-Alternative (B2C-Label) | ✅ | Shopify | 10 | 8 | 7 | 8 | 8 | 9 | **8,4** | Build |
| HubSpot-CRM-Lücke (Reporting) | ✅ | HubSpot | 8 | 6 | 8 | 6 | 9 | 8 | **7,6** | Build |
| Enterprise-Sync (AppExchange) | ✅* | AppExchange | 7 | 5 | 8 | 5 | 10 | 7 | **7,0** | Direct Sales |
| Slack-Bot (Workflow) | ❌ G5 | Slack | 9 | 7 | 8 | 6 | 7 | 9 | — | **Verworfen** (Review) |
| Deep-ML-Analytics-App | ❌ G3 | Shopify | 8 | 5 | 6 | 2 | 9 | 8 | — | **Verworfen** (Komplexität) |

\* AppExchange Kandidat erfüllt Gate nur für **Direct-Sales-Pfad**; öffentliches Listing in W4 nicht möglich.

---

## 5. Eingabe-Template für W0 (Scraping-Ergebnisse)

| Feld | Wert |
| -- | -- |
| Kategorie | z. B. „Import & Export" |
| Marktführer | Name + URL |
| Install-Basis | # |
| Review-Volumen / Ø-Rating | # / x,x★ |
| Top-3-Beschwerde-Muster | 1) … 2) … 3) … |
| Marktführer-Preis | $/Monat, $/Jahr |
| Unser Zielpreis | $/Jahr |
| Integrationen nötig | Liste |
| Store-Launch-Zyklus | Werktage |
| Legal-Check-Ergebnis | ok / Red Flag |

---

## 6. Verknüpfung mit dem Finanzmodell

Der Score ist das **Auswahl-Gate**; das Finanzmodell (`financial-model.xlsx`) liefert den **Beitrag zum €100k-Ziel**.
Jeder Kandidat mit Score ≥ 70 wird mit Preis-, Install- und Setup-Annahme in das Portfolio aufgenommen.
Die 5 Apps des Base Case (App A–E) entsprechen den vier Pre-Fill-Kandidaten in §4 plus einem zweiten
Shopify-Kandidaten.
