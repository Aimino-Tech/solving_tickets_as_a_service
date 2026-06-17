/**
 * ROI Dashboard — Marketing analytics plugin
 *
 * Provides funnel visualization, campaign performance metrics, and
 * conversion tracking. The funnel tab uses the standalone funnel-viz.js
 * renderer; other tabs are placeholder panels for future waves.
 *
 * Plain IIFE, no build step. Uses window.__HERMES_PLUGINS__ for
 * dashboard registration.
 */
(function () {
  "use strict";

  var API = "/api/plugins/roi";

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs.hasOwnProperty(k)) {
          if (k === "className") {
            node.className = attrs[k];
          } else if (k === "innerHTML") {
            node.innerHTML = attrs[k];
          } else if (k === "textContent") {
            node.textContent = attrs[k];
          } else if (k.indexOf("on") === 0) {
            node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
          } else {
            node.setAttribute(k, attrs[k]);
          }
        }
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]) {
          node.appendChild(
            typeof children[i] === "string"
              ? document.createTextNode(children[i])
              : children[i]
          );
        }
      }
    }
    return node;
  }

  function formatNumber(n) {
    if (n == null) return "0";
    return Number(n).toLocaleString("en-US");
  }

  /**
   * Fetch JSON from the plugin API. Throws on non-2xx.
   */
  function fetchJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (body) {
          throw new Error(res.status + ": " + body);
        });
      }
      return res.json();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Funnel Tab                                                        */
  /* ------------------------------------------------------------------ */

  function renderFunnelTab(container) {
    container.innerHTML = "";
    container.appendChild(
      el("div", { className: "roi-loading" }, [
        el("div", { className: "roi-loading-spinner" }),
        document.createTextNode("Loading funnel data\u2026"),
      ])
    );

    fetchJSON(API + "/funnel")
      .then(function (data) {
        container.innerHTML = "";

        // Summary stats
        var statsRow = el("div", { className: "roi-stat-grid" });

        var totalCount = data.counts && data.counts.length > 0
          ? data.counts[0] : 0;
        var finalCount = data.counts && data.counts.length > 0
          ? data.counts[data.counts.length - 1] : 0;
        var overallRate = totalCount > 0
          ? ((finalCount / totalCount) * 100).toFixed(1) + "%" : "\u2014";
        var stageCount = data.stages ? data.stages.length : 0;

        // Find biggest dropoff
        var biggestDrop = 0;
        if (data.counts && data.counts.length >= 2) {
          for (var i = 0; i < data.counts.length - 1; i++) {
            var drop = data.counts[i] - data.counts[i + 1];
            if (drop > biggestDrop) {
              biggestDrop = drop;
            }
          }
        }

        statsRow.appendChild(
          el("div", { className: "roi-stat" }, [
            el("div", { className: "roi-stat-label", textContent: "Top of Funnel" }),
            el("div", { className: "roi-stat-value roi-stat-value--accent", textContent: formatNumber(totalCount) }),
          ])
        );
        statsRow.appendChild(
          el("div", { className: "roi-stat" }, [
            el("div", { className: "roi-stat-label", textContent: "Converted" }),
            el("div", { className: "roi-stat-value roi-stat-value--success", textContent: formatNumber(finalCount) }),
          ])
        );
        statsRow.appendChild(
          el("div", { className: "roi-stat" }, [
            el("div", { className: "roi-stat-label", textContent: "Overall Rate" }),
            el("div", { className: "roi-stat-value", textContent: overallRate }),
          ])
        );
        statsRow.appendChild(
          el("div", { className: "roi-stat" }, [
            el("div", { className: "roi-stat-label", textContent: "Stages" }),
            el("div", { className: "roi-stat-value", textContent: String(stageCount) }),
          ])
        );
        statsRow.appendChild(
          el("div", { className: "roi-stat" }, [
            el("div", { className: "roi-stat-label", textContent: "Biggest Drop" }),
            el("div", { className: "roi-stat-value roi-stat-value--danger", textContent: formatNumber(biggestDrop) }),
          ])
        );

        container.appendChild(statsRow);

        // Funnel visualization
        var funnelCard = el("div", { className: "roi-card", style: "margin-top: 1rem;" });
        var funnelHeader = el("div", { className: "roi-card-header" }, [
          el("div", { className: "roi-card-title", textContent: "Funnel Flow" }),
          el("div", {
            className: "roi-card-subtitle",
            textContent: data.campaign_id
              ? "Campaign: " + data.campaign_id + (data.funnel_date ? " \u2022 " + data.funnel_date : "")
              : (data.funnel_date || ""),
          }),
        ]);
        funnelCard.appendChild(funnelHeader);

        var funnelViz = el("div", { id: "roi-funnel-viz" });
        funnelCard.appendChild(funnelViz);
        container.appendChild(funnelCard);

        // Render the SVG funnel
        if (window.renderFunnelViz) {
          window.renderFunnelViz("roi-funnel-viz", data);
        } else {
          funnelViz.innerHTML =
            '<div class="roi-error">funnel-viz.js not loaded. Include dist/funnel-viz.js before index.js.</div>';
        }
      })
      .catch(function (err) {
        container.innerHTML = "";
        container.appendChild(
          el("div", { className: "roi-error", textContent: "Failed to load funnel data: " + (err.message || err) })
        );
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Campaign Tab (placeholder)                                        */
  /* ------------------------------------------------------------------ */

  function renderCampaignsTab(container) {
    container.innerHTML = "";
    container.appendChild(
      el("div", { className: "roi-placeholder" }, [
        el("div", { className: "roi-placeholder-icon", textContent: "\uD83D\uDCCA" }),
        document.createTextNode("Campaign analytics coming in a future wave."),
      ])
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Reports Tab (placeholder)                                         */
  /* ------------------------------------------------------------------ */

  function renderReportsTab(container) {
    container.innerHTML = "";
    container.appendChild(
      el("div", { className: "roi-placeholder" }, [
        el("div", { className: "roi-placeholder-icon", textContent: "\uD83D\uDCC4" }),
        document.createTextNode("Exportable reports coming in a future wave."),
      ])
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Main Page Component                                               */
  /* ------------------------------------------------------------------ */

  function ROIPage() {
    var container = el("div", { className: "roi-dashboard" });

    // Header
    var header = el("div", { className: "roi-dashboard-header" }, [
      el("div", { className: "roi-dashboard-title" }, [
        el("span", { className: "roi-dashboard-title-icon", textContent: "\u2191" }),
        document.createTextNode("Marketing ROI Dashboard"),
      ]),
    ]);
    container.appendChild(header);

    // Tabs
    var tabs = el("div", { className: "roi-tabs" });
    var panels = el("div");

    var tabDefs = [
      { id: "funnel", label: "Funnel", render: renderFunnelTab },
      { id: "campaigns", label: "Campaigns", render: renderCampaignsTab },
      { id: "reports", label: "Reports", render: renderReportsTab },
    ];

    var tabEls = [];
    var panelEls = [];
    var activeTab = "funnel";

    tabDefs.forEach(function (def) {
      var tab = el("button", {
        className: "roi-tab" + (def.id === activeTab ? " roi-tab--active" : ""),
        textContent: def.label,
        "data-tab": def.id,
        onClick: function () {
          switchTab(def.id);
        },
      });
      tabEls.push(tab);
      tabs.appendChild(tab);

      var panel = el("div", {
        className: "roi-tab-panel" + (def.id === activeTab ? " roi-tab-panel--active" : ""),
        "data-panel": def.id,
      });
      panelEls.push(panel);
      panels.appendChild(panel);
    });

    container.appendChild(tabs);
    container.appendChild(panels);

    function switchTab(tabId) {
      activeTab = tabId;
      tabEls.forEach(function (t, i) {
        var isActive = tabDefs[i].id === tabId;
        t.className = "roi-tab" + (isActive ? " roi-tab--active" : "");
      });
      panelEls.forEach(function (p, i) {
        var isActive = tabDefs[i].id === tabId;
        p.className = "roi-tab-panel" + (isActive ? " roi-tab-panel--active" : "");
      });
      renderActiveTab();
    }

    function renderActiveTab() {
      var idx = -1;
      for (var i = 0; i < tabDefs.length; i++) {
        if (tabDefs[i].id === activeTab) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        tabDefs[idx].render(panelEls[idx]);
      }
    }

    // Initial render
    setTimeout(renderActiveTab, 0);

    return container;
  }

  /* ------------------------------------------------------------------ */
  /*  Register with dashboard                                           */
  /* ------------------------------------------------------------------ */

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("roi-dashboard", ROIPage);
  }
})();
