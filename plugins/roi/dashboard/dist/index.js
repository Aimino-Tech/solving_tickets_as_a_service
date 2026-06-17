/**
 * Hermes Marketing ROI Dashboard — Plugin
 *
 * Inline dashboard inside the Hermes SPA. Fetches KPI data from the plugin
 * API at /api/plugins/roi-dashboard/ and renders using Hermes SDK components.
 *
 * No build step — uses window.__HERMES_PLUGIN_SDK__ for React + shadcn primitives.
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;
  const { Card, CardContent, CardHeader, CardTitle, Badge, Button } = SDK.components;
  const { useState, useEffect, useCallback } = SDK.hooks;
  const { cn } = SDK.utils;

  const API_BASE = "/api/plugins/roi-dashboard";

  // ── Fetch helper ──────────────────────────────────────────────────────────

  function getAuthHeaders() {
    var token = typeof __HERMES_SESSION_TOKEN__ !== "undefined"
      ? __HERMES_SESSION_TOKEN__ : null;
    var h = { Accept: "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  async function fetchJSON(url) {
    var res = await fetch(url, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ── Sub-components ────────────────────────────────────────────────────────

  function KpiCard({ label, value, delta, loading }) {
    const color =
      delta == null ? "text-midground/60"
      : delta > 0 ? "text-green-500"
      : delta < 0 ? "text-red-500"
      : "text-midground/60";
    return h(Card, { className: "min-w-0" },
      h(CardHeader, { className: "pb-2" },
        h(CardTitle, {
          className: "font-mondwest text-[0.65rem] tracking-[0.12em] uppercase text-midground/60"
        }, label)
      ),
      h(CardContent, null,
        loading
          ? h("div", { className: "h-8 w-24 bg-current/5 animate-pulse rounded" })
          : h("div", { className: "flex items-baseline gap-2" },
              h("span", {
                className: "font-mondwest text-2xl font-bold tracking-tight text-midground"
              }, formatNum(value)),
              delta != null
                ? h("span", { className: `font-mondwest text-xs ${color}` },
                    (delta > 0 ? "+" : "") + delta + "%"
                  )
                : null
            )
      )
    );
  }

  function formatNum(n) {
    if (n == null) return "—";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function SentimentBadge({ value }) {
    if (value == null) return null;
    const color =
      value > 0.05 ? "bg-green-500/20 text-green-400"
      : value < -0.05 ? "bg-red-500/20 text-red-400"
      : "bg-yellow-500/20 text-yellow-400";
    return h(Badge, { className: color + " font-mondwest text-xs" }, value.toFixed(3));
  }

  // ── Platform row ──────────────────────────────────────────────────────────

  function PlatformRow({ p }) {
    const barWidth = Math.min(100, Math.max(5, (p.total_score / 500) * 100));
    return h("div", { className: "flex items-center gap-3 py-2 border-b border-current/5 last:border-0" },
      h("span", {
        className: "w-20 shrink-0 font-mondwest text-xs font-bold uppercase tracking-wider text-midground/80"
      }, p.platform),
      h("div", { className: "flex-1 flex items-center gap-2" },
        h("div", {
          className: "h-2 rounded-full bg-current/10 overflow-hidden flex-1",
          style: { maxWidth: 200 }
        },
          h("div", {
            className: "h-full rounded-full bg-current/40 transition-all",
            style: { width: barWidth + "%" }
          })
        ),
        h("span", { className: "font-mondwest text-xs text-midground/60 w-16 text-right" },
          formatNum(p.total_score)
        )
      ),
      h(SentimentBadge, { value: p.avg_sentiment }),
      h("span", { className: "font-mondwest text-[10px] text-midground/40 w-20 text-right" },
        p.post_count + " posts"
      )
    );
  }

  // ── Campaign row ──────────────────────────────────────────────────────────

  function CampaignRow({ c }) {
    return h("div", { className: "flex items-center gap-3 py-2 border-b border-current/5 last:border-0" },
      h("div", { className: "flex-1 min-w-0" },
        h("div", { className: "font-mondwest text-xs font-semibold text-midground truncate" }, c.name),
        h("div", { className: "font-mondwest text-[10px] text-midground/40" }, c.product)
      ),
      h("span", { className: "font-mondwest text-xs text-midground/60 w-16 text-right" },
        formatNum(c.reach)
      ),
      h("span", {
        className: "font-mondwest text-xs w-16 text-right " +
          (c.roi > 0 ? "text-green-500" : c.roi < 0 ? "text-red-500" : "text-midground/60")
      }, c.roi ? (c.roi * 100).toFixed(0) + "%" : "—"),
      h(Badge, {
        className: "font-mondwest text-[10px] " + (
          c.status === "active" ? "bg-green-500/20 text-green-400"
          : c.status === "completed" ? "bg-blue-500/20 text-blue-400"
          : "bg-current/10 text-midground/60"
        )
      }, c.status)
    );
  }

  // ── Funnel bar ────────────────────────────────────────────────────────────

  function FunnelBar({ stages }) {
    const maxCount = Math.max(1, ...stages.map(s => s.count));
    return h("div", { className: "flex items-end gap-1 h-24 pt-2" },
      stages.map(s =>
        h("div", {
          key: s.stage,
          className: "flex-1 flex flex-col items-center gap-1"
        },
          h("div", {
            className: "w-full rounded-t bg-current/30 transition-all hover:bg-current/50 cursor-pointer",
            style: { height: Math.max(4, (s.count / maxCount) * 80) + "px" }
          }),
          h("span", { className: "font-mondwest text-[9px] text-midground/40 uppercase truncate w-full text-center" },
            s.stage.charAt(0).toUpperCase() + s.stage.slice(1, 4)
          ),
          h("span", { className: "font-mondwest text-[10px] text-midground/60" },
            formatNum(s.count)
          )
        )
      )
    );
  }

  // ── Main component ────────────────────────────────────────────────────────

  function ROIDashboard() {
    const [kpis, setKpis] = useState(null);
    const [platforms, setPlatforms] = useState([]);
    const [funnel, setFunnel] = useState([]);
    const [campaigns, setCampaigns] = useState([]);
    const [grafana, setGrafana] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const [kpiData, platData, funnelData, campData, grafData] = await Promise.all([
          fetchJSON(API_BASE + "/kpis?days=30"),
          fetchJSON(API_BASE + "/platforms?days=30"),
          fetchJSON(API_BASE + "/funnel?days=30"),
          fetchJSON(API_BASE + "/campaigns"),
          fetchJSON(API_BASE + "/grafana"),
        ]);
        setKpis(kpiData);
        setPlatforms(platData);
        setFunnel(funnelData);
        setCampaigns(campData);
        setGrafana(grafData);
      } catch (err) {
        setError(err.message || "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (error) {
      return h("div", {
        className: "flex flex-col items-center justify-center gap-3 p-8 text-center"
      },
        h("div", { className: "font-mondwest text-sm text-red-400" }, "⚠ " + error),
        h(Button, { onClick: load, className: "mt-2" }, "Retry")
      );
    }

    return h("div", { className: "flex flex-col gap-4 p-3 sm:p-4 max-w-5xl" },

      // ── Header ──
      h("div", { className: "flex items-center justify-between" },
        h("h1", {
          className: "font-mondwest text-lg font-bold tracking-tight text-midground"
        }, "Marketing ROI"),
        h(Button, {
          onClick: load,
          disabled: loading,
          className: "font-mondwest text-xs"
        }, loading ? "Loading…" : "Refresh")
      ),

      // ── KPI Cards ──
      h("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2" },
        h(KpiCard, { label: "Total Reach", value: kpis?.total_reach, delta: kpis?.reach_change, loading: !kpis }),
        h(KpiCard, { label: "Engagement", value: kpis?.total_engagement, delta: kpis?.engagement_change, loading: !kpis }),
        h(KpiCard, { label: "Avg Sentiment", value: kpis?.avg_sentiment != null ? (kpis.avg_sentiment * 100).toFixed(1) + "%" : null, loading: !kpis }),
        h(KpiCard, { label: "Campaigns", value: kpis?.campaign_count, loading: !kpis })
      ),

      // ── Funnel ──
      funnel.length > 0
        ? h(Card, {},
            h(CardHeader, { className: "pb-2" },
              h(CardTitle, {
                className: "font-mondwest text-[0.65rem] tracking-[0.12em] uppercase text-midground/60"
              }, "Marketing Funnel")
            ),
            h(CardContent, null,
              h(FunnelBar, { stages: funnel })
            )
          )
        : null,

      // ── Platforms ──
      platforms.length > 0
        ? h(Card, {},
            h(CardHeader, { className: "pb-2" },
              h(CardTitle, {
                className: "font-mondwest text-[0.65rem] tracking-[0.12em] uppercase text-midground/60"
              }, "Platform Engagement")
            ),
            h(CardContent, null,
              h("div", { className: "flex flex-col" },
                platforms.map(p => h(PlatformRow, { key: p.platform, p }))
              )
            )
          )
        : null,

      // ── Campaigns ──
      campaigns.length > 0
        ? h(Card, {},
            h(CardHeader, { className: "pb-2" },
              h(CardTitle, {
                className: "font-mondwest text-[0.65rem] tracking-[0.12em] uppercase text-midground/60"
              }, "Campaigns")
            ),
            h(CardContent, null,
              h("div", { className: "flex flex-col" },
                h("div", { className: "flex items-center gap-3 pb-1 border-b border-current/10" },
                  h("span", { className: "flex-1 font-mondwest text-[10px] uppercase tracking-wider text-midground/40" }, "Campaign"),
                  h("span", { className: "font-mondwest text-[10px] uppercase tracking-wider text-midground/40 w-16 text-right" }, "Reach"),
                  h("span", { className: "font-mondwest text-[10px] uppercase tracking-wider text-midground/40 w-16 text-right" }, "ROI"),
                  h("span", { className: "font-mondwest text-[10px] uppercase tracking-wider text-midground/40" }, "Status")
                ),
                campaigns.map(c => h(CampaignRow, { key: c.id, c }))
              )
            )
          )
        : null,

      // ── Grafana dashboards section ──
      h(Card, {},
        h(CardHeader, { className: "pb-2" },
          h(CardTitle, {
            className: "font-mondwest text-[0.65rem] tracking-[0.12em] uppercase text-midground/60"
          }, "Detailed Dashboards"),
        ),
        h(CardContent, null,
          grafana == null
            ? h("div", { className: "flex items-center gap-2" },
                h("div", { className: "h-2 w-2 rounded-full bg-current/20 animate-pulse" }),
                h("span", { className: "font-mondwest text-xs text-midground/40" }, "Checking Grafana status…")
              )
            : grafana.running
              ? h("div", { className: "flex flex-col gap-2" },
                  h("div", { className: "flex items-center gap-2" },
                    h("div", { className: "h-2 w-2 rounded-full bg-green-500" }),
                    h("span", { className: "font-mondwest text-xs text-green-400" }, "Grafana is running on " + grafana.base_url)
                  ),
                  h("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2" },
                    grafana.dashboards.map(d =>
                      h("a", {
                        key: d.id,
                        href: d.url,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        className: cn(
                          "block p-3 rounded border border-current/10",
                          "hover:border-current/30 hover:bg-current/5 transition-colors",
                          "font-mondwest text-xs text-midground/80"
                        )
                      },
                        h("div", { className: "font-semibold text-midground" }, d.label),
                        h("div", { className: "text-[10px] text-midground/40 mt-0.5" }, "Open in Grafana →")
                      )
                    )
                  )
                )
              : h("div", { className: "flex flex-col gap-2" },
                  h("div", { className: "flex items-center gap-2" },
                    h("div", { className: "h-2 w-2 rounded-full bg-red-500" }),
                    h("span", { className: "font-mondwest text-xs text-red-400" }, "Grafana not running")
                  ),
                  h("div", { className: "font-mondwest text-[11px] text-midground/60" },
                    "Start with: docker compose -f docker-compose.grafana.yml up -d"
                  )
                )
        )
      ),

      // ── Empty state ──
      !loading && kpis && kpis.total_reach === 0
        ? h("div", { className: "text-center py-8" },
            h("div", { className: "font-mondwest text-sm text-midground/40 mb-2" },
              "No marketing data yet"
            ),
            h("div", { className: "font-mondwest text-xs text-midground/30" },
              "Collect data via GitHub Actions daily cron or run: python -m marketing.collectors.run_all"
            )
          )
        : null
    );
  }

  // ── Register plugin ──────────────────────────────────────────────────────

  window.__HERMES_PLUGINS__.register("roi-dashboard", ROIDashboard);
})();
