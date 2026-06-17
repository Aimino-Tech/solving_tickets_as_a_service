/**
 * Funnel Visualization — Marketing ROI Dashboard
 *
 * Renders a Sankey-style funnel flow diagram showing marketing funnel
 * stages: awareness → engagement → interest → consideration →
 * conversion → retention.
 *
 * Pure SVG, no external dependencies. Uses viewBox for responsive sizing.
 *
 * Usage:
 *   window.renderFunnelViz("container-id", {
 *     stages: ["awareness", "engagement", ...],
 *     counts: [1200, 850, ...],
 *     conversion_rates: [0.708, 0.494, ...],
 *     campaign_id: "ODW001",
 *     funnel_date: "2026-06-16"
 *   });
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Design tokens — match the ROI dashboard dark theme                 */
  /* ------------------------------------------------------------------ */

  var COLORS = {
    bgDark: "#1a1a2e",
    bgCard: "#16213e",
    accent: "#00d4ff",
    accentDim: "rgba(0, 212, 255, 0.15)",
    success: "#00e676",
    warning: "#ff9100",
    danger: "#ff1744",
    textPrimary: "#ffffff",
    textSecondary: "#8892b0",
    textMuted: "#5a6380",
    barFill: "#00d4ff",
    barFillAlt: "#0099cc",
    barStroke: "rgba(0, 212, 255, 0.4)",
    connectorFill: "rgba(0, 212, 255, 0.08)",
    connectorStroke: "rgba(0, 212, 255, 0.25)",
    dropoffHighlight: "#ff1744",
    dropoffBg: "rgba(255, 23, 68, 0.12)",
    dropoffBorder: "rgba(255, 23, 68, 0.35)",
  };

  /* Stage colour progression — cool to warm as the funnel narrows */
  var STAGE_COLORS = [
    "#00d4ff", // awareness — cyan
    "#00bcd4", // engagement — teal
    "#009688", // interest — green-teal
    "#4caf50", // consideration — green
    "#ff9800", // conversion — amber
    "#e91e63", // retention — pink
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Format a number with comma separators: 1200 → "1,200".
   */
  function formatNumber(n) {
    if (n == null) return "0";
    return Number(n).toLocaleString("en-US");
  }

  /**
   * Format a ratio (0–1) as a percentage string: 0.708 → "70.8%".
   */
  function pct(ratio) {
    if (ratio == null) return "\u2014";
    return (ratio * 100).toFixed(1) + "%";
  }

  /**
   * Create an SVG element with attributes.
   */
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs.hasOwnProperty(k)) {
          el.setAttribute(k, attrs[k]);
        }
      }
    }
    return el;
  }

  /**
   * Create a <text> element with content.
   */
  function svgText(content, attrs) {
    var el = svgEl("text", attrs);
    el.textContent = content;
    return el;
  }

  /**
   * Title-case a stage name: "awareness" → "Awareness".
   */
  function titleCase(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
  }

  /* ------------------------------------------------------------------ */
  /*  Edge-case renderers                                                */
  /* ------------------------------------------------------------------ */

  function renderEmpty(container) {
    container.innerHTML = "";
    var msg = document.createElement("div");
    msg.className = "roi-funnel-empty";
    msg.innerHTML =
      '<div class="roi-funnel-empty-icon">\uD83D\uDCCA</div>' +
      '<div class="roi-funnel-empty-title">No funnel data available</div>' +
      '<div class="roi-funnel-empty-hint">Start a campaign to see funnel analytics here.</div>';
    container.appendChild(msg);
  }

  function renderSingleStage(container, data) {
    container.innerHTML = "";
    var wrapper = document.createElement("div");
    wrapper.className = "roi-funnel-single";
    var stage = data.stages[0];
    var count = data.counts[0];
    wrapper.innerHTML =
      '<div class="roi-funnel-single-bar">' +
      '<div class="roi-funnel-single-label">' + titleCase(stage) + "</div>" +
      '<div class="roi-funnel-single-count">' + formatNumber(count) + "</div>" +
      "</div>" +
      '<div class="roi-funnel-single-note">Insufficient stages for funnel analysis</div>';
    container.appendChild(wrapper);
  }

  function renderZeroBottleneck(container, data) {
    // Find the first stage with zero count
    var zeroIdx = -1;
    for (var i = 0; i < data.counts.length; i++) {
      if (data.counts[i] === 0) {
        zeroIdx = i;
        break;
      }
    }
    container.innerHTML = "";
    var wrapper = document.createElement("div");
    wrapper.className = "roi-funnel-bottleneck";
    wrapper.innerHTML =
      '<div class="roi-funnel-bottleneck-icon">\u26A0\uFE0F</div>' +
      '<div class="roi-funnel-bottleneck-title">Funnel Bottleneck Detected</div>' +
      '<div class="roi-funnel-bottleneck-detail">' +
      "Stage <strong>" + titleCase(data.stages[zeroIdx]) + "</strong> has zero entries. " +
      "No users progressed past this point." +
      "</div>";
    container.appendChild(wrapper);

    // Still render the visual with the zero stage shown
    renderSVG(container, data);
  }

  /* ------------------------------------------------------------------ */
  /*  Main SVG renderer                                                 */
  /* ------------------------------------------------------------------ */

  function renderSVG(container, data) {
    var stages = data.stages || [];
    var counts = data.counts || [];
    var convRates = data.conversion_rates || [];
    var campaignId = data.campaign_id || "";
    var funnelDate = data.funnel_date || "";

    if (stages.length === 0) {
      renderEmpty(container);
      return;
    }
    if (stages.length === 1) {
      renderSingleStage(container, data);
      return;
    }

    // Check for zero counts — render bottleneck warning + the visual
    var hasZero = false;
    for (var z = 0; z < counts.length; z++) {
      if (counts[z] === 0) {
        hasZero = true;
        break;
      }
    }

    // If there's a zero bottleneck AND the container doesn't already have
    // the bottleneck message, render it. Otherwise just render SVG.
    if (hasZero && !container.querySelector(".roi-funnel-bottleneck")) {
      renderZeroBottleneck(container, data);
      return;
    }

    // ---- Layout constants (in viewBox units) ----
    var VB_W = 800;
    var HEADER_H = 50;
    var STAGE_H = 52;       // height per stage bar
    var GAP_H = 36;         // gap between stages (for conversion rate label)
    var SIDE_PAD = 140;     // left padding for labels
    var RIGHT_PAD = 80;     // right padding for percentages
    var BAR_MIN_W = 60;     // minimum bar width
    var BAR_AREA_W = VB_W - SIDE_PAD - RIGHT_PAD; // available width for bars
    var TOP_PAD = 10;
    var BOTTOM_PAD = 20;

    var n = stages.length;
    var totalH = HEADER_H + TOP_PAD + n * STAGE_H + (n - 1) * GAP_H + BOTTOM_PAD;

    // Find max count for proportional scaling
    var maxCount = 0;
    for (var i = 0; i < counts.length; i++) {
      if (counts[i] > maxCount) maxCount = counts[i];
    }
    if (maxCount === 0) maxCount = 1; // prevent division by zero

    // Find biggest dropoff
    var biggestDropIdx = 0;
    var biggestDrop = 0;
    for (var d = 0; d < counts.length - 1; d++) {
      var drop = counts[d] - counts[d + 1];
      if (drop > biggestDrop) {
        biggestDrop = drop;
        biggestDropIdx = d;
      }
    }

    // ---- Create SVG ----
    var svg = svgEl("svg", {
      viewBox: "0 0 " + VB_W + " " + totalH,
      preserveAspectRatio: "xMidYMid meet",
      class: "roi-funnel-svg",
      role: "img",
      "aria-label": "Marketing funnel visualization for campaign " + campaignId,
    });

    // ---- Header ----
    var headerY = 28;
    var headerText = "Funnel Flow";
    if (campaignId) headerText += " \u2014 " + campaignId;
    svg.appendChild(svgText(headerText, {
      x: VB_W / 2, y: headerY,
      "text-anchor": "middle",
      fill: COLORS.textPrimary,
      "font-size": "18",
      "font-weight": "700",
      "font-family": "system-ui, -apple-system, sans-serif",
    }));

    if (funnelDate) {
      svg.appendChild(svgText(funnelDate, {
        x: VB_W / 2, y: headerY + 18,
        "text-anchor": "middle",
        fill: COLORS.textSecondary,
        "font-size": "11",
        "font-family": "system-ui, -apple-system, sans-serif",
      }));
    }

    // ---- Defs: gradients and filters ----
    var defs = svgEl("defs");

    // Drop shadow filter
    var filter = svgEl("filter", { id: "funnel-shadow", x: "-5%", y: "-10%", width: "110%", height: "130%" });
    var feDropShadow = svgEl("feDropShadow", {
      dx: 0, dy: 2, stdDeviation: 3,
      "flood-color": "rgba(0,0,0,0.3)",
      "flood-opacity": "0.3",
    });
    filter.appendChild(feDropShadow);
    defs.appendChild(filter);

    // Glow filter for highlighted dropoff
    var glowFilter = svgEl("filter", { id: "dropoff-glow", x: "-10%", y: "-20%", width: "120%", height: "140%" });
    var feGaussian = svgEl("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 4, result: "blur" });
    var feFlood = svgEl("feFlood", { "flood-color": COLORS.dropoffHighlight, "flood-opacity": "0.4", result: "color" });
    var feComposite = svgEl("feComposite", { in: "color", in2: "blur", operator: "in", result: "glow" });
    var feMerge = svgEl("feMerge");
    feMerge.appendChild(svgEl("feMergeNode", { in: "glow" }));
    feMerge.appendChild(svgEl("feMergeNode", { in: "SourceGraphic" }));
    glowFilter.appendChild(feGaussian);
    glowFilter.appendChild(feFlood);
    glowFilter.appendChild(feComposite);
    glowFilter.appendChild(feMerge);
    defs.appendChild(glowFilter);

    // Bar gradients
    for (var g = 0; g < n; g++) {
      var grad = svgEl("linearGradient", {
        id: "bar-grad-" + g, x1: "0", y1: "0", x2: "1", y2: "0",
      });
      var baseColor = STAGE_COLORS[g % STAGE_COLORS.length];
      grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": baseColor, "stop-opacity": "0.9" }));
      grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": baseColor, "stop-opacity": "0.65" }));
      defs.appendChild(grad);
    }

    svg.appendChild(defs);

    // ---- Draw stages ----
    var barHeights = [];
    var barWidths = [];
    var barXs = [];
    var barYs = [];

    for (var s = 0; s < n; s++) {
      var y = HEADER_H + TOP_PAD + s * (STAGE_H + GAP_H);
      var ratio = maxCount > 0 ? counts[s] / maxCount : 0;
      var barW = Math.max(BAR_MIN_W, ratio * BAR_AREA_W);
      var barX = SIDE_PAD + (BAR_AREA_W - barW) / 2;

      barHeights.push(STAGE_H);
      barWidths.push(barW);
      barXs.push(barX);
      barYs.push(y);

      var isDropoff = (s === biggestDropIdx);

      // Draw connector from previous stage
      if (s > 0) {
        var prevY = barYs[s - 1] + barHeights[s - 1];
        var prevX = barXs[s - 1];
        var prevW = barWidths[s - 1];
        var curX = barX;
        var curW = barW;

        // Trapezoid connector — represents flow narrowing
        var pathD =
          "M " + prevX + " " + prevY +
          " L " + (prevX + prevW) + " " + prevY +
          " L " + (curX + curW) + " " + y +
          " L " + curX + " " + y +
          " Z";

        svg.appendChild(svgEl("path", {
          d: pathD,
          fill: COLORS.connectorFill,
          stroke: COLORS.connectorStroke,
          "stroke-width": "0.5",
        }));

        // Conversion rate label in the gap
        var gapY = prevY + GAP_H / 2 + 2;
        var rate = (convRates[s - 1] != null) ? pct(convRates[s - 1]) : "\u2014";
        var rateColor = COLORS.textSecondary;
        if (convRates[s - 1] != null && convRates[s - 1] < 0.3) {
          rateColor = COLORS.warning;
        }
        if (convRates[s - 1] != null && convRates[s - 1] < 0.15) {
          rateColor = COLORS.danger;
        }

        svg.appendChild(svgText("\u25BC " + rate, {
          x: VB_W / 2,
          y: gapY,
          "text-anchor": "middle",
          fill: rateColor,
          "font-size": "11",
          "font-weight": "600",
          "font-family": "ui-monospace, SFMono-Regular, monospace",
        }));

        // Dropoff count between stages
        var dropoffCount = counts[s - 1] - counts[s];
        if (dropoffCount > 0) {
          svg.appendChild(svgText("-" + formatNumber(dropoffCount), {
            x: VB_W / 2,
            y: gapY + 14,
            "text-anchor": "middle",
            fill: COLORS.textMuted,
            "font-size": "9",
            "font-family": "ui-monospace, SFMono-Regular, monospace",
          }));
        }
      }

      // ---- Stage bar ----
      var barGroup = svgEl("g", { class: "roi-funnel-bar-group" });

      // Bar background
      barGroup.appendChild(svgEl("rect", {
        x: barX, y: y, width: barW, height: STAGE_H,
        rx: 6, ry: 6,
        fill: "url(#bar-grad-" + s + ")",
        stroke: isDropoff ? COLORS.dropoffHighlight : COLORS.barStroke,
        "stroke-width": isDropoff ? "1.5" : "0.5",
        filter: isDropoff ? "url(#dropoff-glow)" : "url(#funnel-shadow)",
        opacity: isDropoff ? "1" : "0.85",
      }));

      // Stage label (left side)
      var labelEl = svgText(titleCase(stages[s]), {
        x: SIDE_PAD - 12,
        y: y + STAGE_H / 2 + 1,
        "text-anchor": "end",
        "dominant-baseline": "middle",
        fill: COLORS.textPrimary,
        "font-size": "13",
        "font-weight": "600",
        "font-family": "system-ui, -apple-system, sans-serif",
      });
      barGroup.appendChild(labelEl);

      // Count (centered in bar)
      barGroup.appendChild(svgText(formatNumber(counts[s]), {
        x: barX + barW / 2,
        y: y + STAGE_H / 2 + 1,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: COLORS.textPrimary,
        "font-size": "15",
        "font-weight": "700",
        "font-family": "ui-monospace, SFMono-Regular, monospace",
      }));

      // Percentage of max (right side)
      var pctOfMax = maxCount > 0 ? ((counts[s] / maxCount) * 100).toFixed(1) + "%" : "0%";
      barGroup.appendChild(svgText(pctOfMax, {
        x: SIDE_PAD + BAR_AREA_W + 12,
        y: y + STAGE_H / 2 + 1,
        "text-anchor": "start",
        "dominant-baseline": "middle",
        fill: COLORS.textSecondary,
        "font-size": "12",
        "font-family": "ui-monospace, SFMono-Regular, monospace",
      }));

      // Dropoff warning icon
      if (isDropoff && biggestDrop > 0) {
        barGroup.appendChild(svgText("\u26A0", {
          x: barX + barW + 6,
          y: y + STAGE_H / 2 + 1,
          "dominant-baseline": "middle",
          fill: COLORS.dropoffHighlight,
          "font-size": "14",
        }));
      }

      svg.appendChild(barGroup);
    }

    // ---- Dropoff Analysis Section ----
    var analysisY = HEADER_H + TOP_PAD + n * STAGE_H + (n - 1) * GAP_H + 16;
    var analysisH = 80;

    // Background panel
    svg.appendChild(svgEl("rect", {
      x: 20, y: analysisY,
      width: VB_W - 40, height: analysisH,
      rx: 8, ry: 8,
      fill: COLORS.bgCard,
      stroke: COLORS.dropoffBorder,
      "stroke-width": "0.5",
      opacity: "0.9",
    }));

    // Title
    svg.appendChild(svgText("Dropoff Analysis", {
      x: 40, y: analysisY + 18,
      fill: COLORS.textSecondary,
      "font-size": "11",
      "font-weight": "700",
      "letter-spacing": "0.08em",
      "font-family": "system-ui, -apple-system, sans-serif",
    }));

    // Biggest dropoff detail
    if (biggestDrop > 0 && biggestDropIdx < stages.length - 1) {
      var fromStage = titleCase(stages[biggestDropIdx]);
      var toStage = titleCase(stages[biggestDropIdx + 1]);
      var dropPct = counts[biggestDropIdx] > 0
        ? ((biggestDrop / counts[biggestDropIdx]) * 100).toFixed(1)
        : "0";

      svg.appendChild(svgText(
        "Biggest drop: " + fromStage + " \u2192 " + toStage,
        {
          x: 40, y: analysisY + 38,
          fill: COLORS.textPrimary,
          "font-size": "12",
          "font-weight": "600",
          "font-family": "system-ui, -apple-system, sans-serif",
        }
      ));

      svg.appendChild(svgText(
        formatNumber(biggestDrop) + " lost, " + dropPct + "% dropoff",
        {
          x: 40, y: analysisY + 56,
          fill: COLORS.dropoffHighlight,
          "font-size": "12",
          "font-family": "ui-monospace, SFMono-Regular, monospace",
        }
      ));
    }

    // Overall conversion rate (first → last)
    if (counts.length >= 2 && counts[0] > 0) {
      var overallRate = ((counts[counts.length - 1] / counts[0]) * 100).toFixed(1);
      svg.appendChild(svgText(
        "Overall: " + formatNumber(counts[0]) + " \u2192 " + formatNumber(counts[counts.length - 1]) +
        " (" + overallRate + "%)",
        {
          x: VB_W - 40, y: analysisY + 38,
          "text-anchor": "end",
          fill: COLORS.textSecondary,
          "font-size": "11",
          "font-family": "ui-monospace, SFMono-Regular, monospace",
        }
      ));
    }

    // ---- Append to container ----
    container.appendChild(svg);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Render a funnel visualization into a container element.
   *
   * @param {string|HTMLElement} container - DOM id or element reference
   * @param {Object} data - Funnel data object
   * @param {string[]} data.stages - Stage names
   * @param {number[]} data.counts - User counts per stage
   * @param {number[]} data.conversion_rates - Rates between adjacent stages
   * @param {string} [data.campaign_id] - Campaign identifier
   * @param {string} [data.funnel_date] - Date string
   */
  function renderFunnelViz(container, data) {
    var el = typeof container === "string"
      ? document.getElementById(container)
      : container;

    if (!el) {
      console.warn("[funnel-viz] Container not found:", container);
      return;
    }

    if (!data || !data.stages || data.stages.length === 0) {
      renderEmpty(el);
      return;
    }

    el.innerHTML = "";
    el.classList.add("roi-funnel-container");

    renderSVG(el, data);
  }

  // Expose globally
  window.renderFunnelViz = renderFunnelViz;
})();
