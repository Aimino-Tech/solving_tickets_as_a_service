<<<<<<< HEAD
(function() {
  'use strict';

  const BASE = '/api/plugins/monitoring';

  function getToken() {
    return window.__HERMES_SESSION_TOKEN__ || '';
  }

  async function api(path) {
    const r = await fetch(BASE + path, {
      headers: { 'X-Hermes-Session-Token': getToken() }
    });
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  }

  function fmtAgo(iso) {
    if (!iso) return 'never';
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 0) return 'now';
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  function id(v) { return document.getElementById(v); }

  function showTab(name) {
    ['overview','metrics','alerts','cron'].forEach(function(t) {
      var el = id('tab-' + t);
      var btn = id('btn-' + t);
      if (el) el.style.display = (t === name ? 'block' : 'none');
      if (btn) btn.className = (t === name ? 'tab-btn active' : 'tab-btn');
    });
  }

  // ---- Overview ----
  async function renderOverview() {
    var el = id('tab-overview');
    if (!el) return;
    try {
      var d = await api('/summary');
      var lv = d.latest_values || {};
      var gw = lv['gateway.state'];
      var gwState = gw ? (gw.tags ? gw.tags.state : 'unknown') : 'N/A';
      var agents = lv['gateway.active_agents'];
      var rss = lv['memory.rss_mb'];
      var disk = lv['disk.hermes_home_used_pct'];
      var cronT = lv['cron.jobs_total'];
      var cronE = lv['cron.jobs_error'];
      var platE = lv['gateway.platforms_error'];
      el.innerHTML =
        '<div class="metric-card"><h3>Gateway Status</h3><p class="value">' + gwState + '</p></div>' +
        '<div class="metric-card"><h3>Active Agents</h3><p class="value">' + (agents ? agents.value : 'N/A') + '</p></div>' +
        '<div class="metric-card"><h3>Memory RSS</h3><p class="value">' + (rss ? rss.value.toFixed(1) + ' MB' : 'N/A') + '</p></div>' +
        '<div class="metric-card"><h3>Disk Usage</h3><p class="value">' + (disk ? disk.value + '%' : 'N/A') + '</p></div>' +
        '<div class="metric-card"><h3>Cron Jobs</h3><p class="value">' + (cronT ? cronT.value : 0) + ' total' +
          (cronE && cronE.value > 0 ? ' <span style="color:#ef4444">(' + cronE.value + ' errors)</span>' : '') + '</p></div>' +
        '<div class="metric-card"><h3>Platform Errors</h3><p class="value">' + (platE ? platE.value : 0) + '</p></div>';
    } catch(e) {
      el.innerHTML = '<p style="color:#ef4444">Error: ' + e.message + '</p>';
    }
  }

  // ---- Metrics ----
  async function renderMetrics() {
    var el = id('tab-metrics');
    if (!el) return;
    try {
      var d = await api('/metrics/names');
      var names = d.names || [];
      if (!names.length) { el.innerHTML = '<p>No metrics recorded yet.</p>'; return; }
      var html = '<div style="margin-bottom:8px"><input id="metric-filter" placeholder="Filter metrics..." ' +
        'oninput="renderMetricList()" style="width:100%;padding:6px;border:1px solid #333;border-radius:4px;background:#1a1a2e;color:#e0e0e0"></div>' +
        '<div id="metric-list">';
      html += names.map(function(n) {
        return '<div class="metric-name" onclick="showMetricDetail(\'' + n.replace(/'/g,"\\'") + '\')">' +
          '<span class="metric-dot"></span>' + n + '</div>';
      }).join('');
      html += '</div>';
      el.innerHTML = html;
    } catch(e) {
      el.innerHTML = '<p style="color:#ef4444">Error: ' + e.message + '</p>';
    }
  }

  window.renderMetricList = function() {
    var filter = id('metric-filter');
    var list = id('metric-list');
    if (!filter || !list) return;
    var q = filter.value.toLowerCase();
    var items = list.querySelectorAll('.metric-name');
    items.forEach(function(item) {
      item.style.display = item.textContent.toLowerCase().indexOf(q) !== -1 ? 'flex' : 'none';
    });
  };

  window.showMetricDetail = async function(name) {
    var el = id('metric-detail');
    if (!el) return;
    try {
      var d = await api('/metrics/latest?name=' + encodeURIComponent(name));
      el.innerHTML =
        '<h3 style="margin:0 0 8px">' + name + '</h3>' +
        '<p>Value: <strong>' + d.value + '</strong></p>' +
        '<p>Recorded: ' + fmtAgo(d.recorded_at) + '</p>' +
        (d.tags ? '<p>Tags: ' + JSON.stringify(d.tags) + '</p>' : '') +
        '<p style="margin-top:8px"><button class="tab-btn" onclick="id(\'metric-detail\').innerHTML=\'\'">Close</button></p>';
    } catch(e) {
      el.innerHTML = '<p style="color:#ef4444">Error: ' + e.message + '</p>';
    }
  };

  // ---- Alerts ----
  async function renderAlerts() {
    var el = id('tab-alerts');
    if (!el) return;
    try {
      var d = await api('/metrics/names');
      el.innerHTML = '<p>Alert configuration will appear here. Metrics tracked: ' + (d.names ? d.names.length : 0) + '.</p>' +
        '<p style="color:#888;font-size:12px;margin-top:16px">Configure alerts via <code>hermes monitoring alert create</code> CLI.</p>';
    } catch(e) {
      el.innerHTML = '<p style="color:#ef4444">Error: ' + e.message + '</p>';
    }
  }

  // ---- Cron ----
  async function renderCron() {
    var el = id('tab-cron');
    if (!el) return;
    try {
      var d = await api('/summary');
      var lv = d.latest_values || {};
      var total = lv['cron.jobs_total'];
      var enabled = lv['cron.jobs_enabled'];
      var error = lv['cron.jobs_error'];
      el.innerHTML =
        '<div class="metric-card"><h3>Total Jobs</h3><p class="value">' + (total ? total.value : 0) + '</p></div>' +
        '<div class="metric-card"><h3>Enabled</h3><p class="value">' + (enabled ? enabled.value : 0) + '</p></div>' +
        '<div class="metric-card"><h3>Errors</h3><p class="value">' + (error ? error.value : 0) + '</p></div>';
    } catch(e) {
      el.innerHTML = '<p style="color:#ef4444">Error: ' + e.message + '</p>';
    }
  }

  // ---- Entry ----
  window.renderMonitoringDashboard = function(container) {
    container.innerHTML =
      '<div class="monitoring-dashboard">' +
        '<div class="tab-bar">' +
          '<button id="btn-overview" class="tab-btn active" onclick="showTab(\'overview\')">Overview</button>' +
          '<button id="btn-metrics" class="tab-btn" onclick="showTab(\'metrics\')">Metrics</button>' +
          '<button id="btn-alerts" class="tab-btn" onclick="showTab(\'alerts\')">Alerts</button>' +
          '<button id="btn-cron" class="tab-btn" onclick="showTab(\'cron\')">Cron</button>' +
        '</div>' +
        '<div id="tab-overview" class="tab-content"><p>Loading overview...</p></div>' +
        '<div id="tab-metrics" class="tab-content" style="display:none"><p>Loading metrics...</p></div>' +
        '<div id="metric-detail" class="metric-detail"></div>' +
        '<div id="tab-alerts" class="tab-content" style="display:none"><p>Loading alerts...</p></div>' +
        '<div id="tab-cron" class="tab-content" style="display:none"><p>Loading cron...</p></div>' +
      '</div>' +
      '<style>' +
        '.monitoring-dashboard{font-family:system-ui,sans-serif;padding:16px;color:#e0e0e0}' +
        '.tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #333}' +
        '.tab-btn{background:#1a1a2e;color:#888;border:1px solid transparent;padding:8px 16px;cursor:pointer;border-radius:4px 4px 0 0}' +
        '.tab-btn.active{color:#60a5fa;border-color:#333 #333 #1a1a2e}' +
        '.tab-btn:hover{color:#e0e0e0}' +
        '.tab-content{padding:8px 0}' +
        '.metric-card{display:inline-block;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;margin:8px;min-width:160px}' +
        '.metric-card h3{margin:0 0 8px;font-size:12px;color:#888;text-transform:uppercase}' +
        '.metric-card .value{font-size:24px;font-weight:600;color:#e0e0e0}' +
        '.metric-name{display:flex;align-items:center;padding:6px 8px;cursor:pointer;border-radius:4px}' +
        '.metric-name:hover{background:#1a1a2e}' +
        '.metric-dot{width:8px;height:8px;border-radius:50%;background:#60a5fa;margin-right:8px}' +
        '.metric-detail{background:#1a1a2e;border:1px solid #60a5fa;border-radius:8px;padding:16px;margin:8px 0}' +
      '</style>';

    renderOverview();
    renderMetrics();
    renderAlerts();
    renderCron();

    setInterval(function() {
      var vis = id('tab-overview');
      if (vis && vis.style.display !== 'none') renderOverview();
    }, 10000);
  };
=======
(function () {
  "use strict";

  var API = "/api/plugins/monitoring";
  var TOKEN = window.__HERMES_SESSION_TOKEN__ || "";

  function authHeaders() {
    return TOKEN ? { Authorization: "Bearer " + TOKEN } : {};
  }

  function api(path) {
    return fetch(API + path, { headers: authHeaders() }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || r.statusText); });
      return r.json();
    });
  }

  function escape(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function ago(ts) {
    if (!ts) return "—";
    var s = Math.floor((Date.now() / 1000 - (typeof ts === "number" ? ts : new Date(ts).getTime() / 1000)));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function tabId() { return window.location.hash.slice(1) || "overview"; }

  function render(root) {
    var state = { summary: null, metrics: null, alerts: null, loading: true, error: null };

    function setState(partial) {
      for (var k in partial) state[k] = partial[k];
      renderView();
    }

    function renderView() {
      var tab = tabId();
      root.innerHTML =
        '<div class="mon-dash">' +
          '<div class="mon-nav">' +
            '<a href="#overview" class="mon-nav-item' + (tab === "overview" ? " mon-nav-item--active" : "") + '">Overview</a>' +
            '<a href="#metrics" class="mon-nav-item' + (tab === "metrics" ? " mon-nav-item--active" : "") + '">Metrics</a>' +
            '<a href="#alerts" class="mon-nav-item' + (tab === "alerts" ? " mon-nav-item--active" : "") + '">Alerts</a>' +
            '<a href="#cron" class="mon-nav-item' + (tab === "cron" ? " mon-nav-item--active" : "") + '">Cron</a>' +
          '</div>' +
          '<div class="mon-content">' +
            (state.loading ? '<div class="mon-loading">Loading monitoring data…</div>' :
             state.error ? '<div class="mon-error">' + escape(state.error) + '</div>' :
             tab === "overview" ? renderOverview() :
             tab === "metrics" ? renderMetrics() :
             tab === "alerts" ? renderAlerts() :
             tab === "cron" ? renderCron() : "") +
          '</div>' +
        '</div>';
    }

    function renderOverview() {
      var s = state.summary;
      if (!s) return "";
      var gw = s.gateway || {};
      var plats = gw.platforms || {};
      var platHtml = "";
      for (var k in plats) {
        var p = plats[k];
        platHtml += '<div class="mon-stat"><span class="mon-stat-label">' + escape(k) +
          '</span><span class="mon-stat-value">' + escape(p.state || "?") + "</span></div>";
      }
      var metrics = s.metrics || {};
      var mList = Object.keys(metrics).slice(0, 20);
      var mHtml = "";
      for (var i = 0; i < mList.length; i++) {
        var m = metrics[mList[i]];
        mHtml += '<div class="mon-stat"><span class="mon-stat-label">' + escape(mList[i]) +
          '</span><span class="mon-stat-value">' + escape(m.value != null ? m.value : "—") +
          '</span><span class="mon-stat-ago">' + ago(m.recorded_at) + "</span></div>";
      }
      return '<div class="mon-grid">' +
        '<div class="mon-section"><div class="mon-section-title">Gateway</div>' +
          '<div class="mon-stat"><span class="mon-stat-label">State</span><span class="mon-stat-value">' + escape(gw.state) + "</span></div>" +
          '<div class="mon-stat"><span class="mon-stat-label">PID</span><span class="mon-stat-value">' + (gw.pid || "—") + "</span></div>" +
          '<div class="mon-stat"><span class="mon-stat-label">Active Agents</span><span class="mon-stat-value">' + (gw.active_agents || 0) + "</span></div>" +
        "</div>" +
        '<div class="mon-section"><div class="mon-section-title">Platforms</div>' + platHtml + "</div>" +
        '<div class="mon-section"><div class="mon-section-title">Metrics (latest ' + mList.length + ")</div>" + mHtml + "</div>" +
        '<div class="mon-section"><div class="mon-section-title">Alerts</div>' +
          '<div class="mon-stat"><span class="mon-stat-label">Total</span><span class="mon-stat-value">' + (s.alerts ? s.alerts.total : 0) + "</span></div>" +
          '<div class="mon-stat"><span class="mon-stat-label">Firing</span><span class="mon-stat-value mon-stat-value--warn">' + (s.alerts ? s.alerts.firing : 0) + "</span></div>" +
        "</div>" +
        '<div class="mon-section"><div class="mon-section-title">Cron</div>' +
          '<div class="mon-stat"><span class="mon-stat-label">Total</span><span class="mon-stat-value">' + (s.cron ? s.cron.total : 0) + "</span></div>" +
          '<div class="mon-stat"><span class="mon-stat-label">Enabled</span><span class="mon-stat-value">' + (s.cron ? s.cron.enabled : 0) + "</span></div>" +
          '<div class="mon-stat"><span class="mon-stat-label">Errors</span><span class="mon-stat-value mon-stat-value--err">' + (s.cron ? s.cron.error : 0) + "</span></div>" +
        "</div>" +
      "</div>";
    }

    function renderMetrics() {
      var m = state.metrics;
      if (!m || !m.metrics) return "<div class=mon-loading>Loading metrics…</div>";
      var names = Object.keys(m.metrics);
      if (names.length === 0) return '<div class="mon-empty">No metrics recorded yet.</div>';
      var html = '<table class="mon-table"><thead><tr><th>Metric</th><th>Latest Value</th><th>Age</th></tr></thead><tbody>';
      for (var i = 0; i < names.length; i++) {
        var rows = m.metrics[names[i]];
        var latest = rows && rows.length > 0 ? rows[0] : null;
        var val = latest ? latest.value : "—";
        var ts = latest ? ago(latest.recorded_at) : "—";
        html += "<tr><td>" + escape(names[i]) + "</td><td>" + escape(val) + "</td><td>" + ts + "</td></tr>";
      }
      html += "</tbody></table>";
      return html;
    }

    function renderAlerts() {
      var a = state.alerts;
      if (!a || !a.alerts) return "<div class=mon-loading>Loading alerts…</div>";
      if (a.alerts.length === 0) return '<div class="mon-empty">No alert configurations defined.</div>';
      var html = '<table class="mon-table"><thead><tr><th>Name</th><th>Metric</th><th>Condition</th><th>Threshold</th><th>Last Fired</th><th>Status</th></tr></thead><tbody>';
      for (var i = 0; i < a.alerts.length; i++) {
        var al = a.alerts[i];
        var firing = al.last_fired_at ? "firing" : "ok";
        html += "<tr>" +
          "<td>" + escape(al.name) + "</td>" +
          "<td>" + escape(al.metric_name) + "</td>" +
          "<td>" + escape(al.condition) + "</td>" +
          "<td>" + escape(al.threshold) + "</td>" +
          "<td>" + ago(al.last_fired_at) + "</td>" +
          '<td><span class="mon-badge mon-badge--' + firing + '">' + firing + "</span></td>" +
          "</tr>";
      }
      html += "</tbody></table>";
      return html;
    }

    function renderCron() {
      if (!state.summary || !state.summary.cron) return "<div class=mon-loading>Loading cron…</div>";
      var jobs = state.summary.cron.jobs || [];
      if (jobs.length === 0) return '<div class="mon-empty">No cron jobs scheduled.</div>';
      var html = '<table class="mon-table"><thead><tr><th>Name</th><th>Schedule</th><th>Enabled</th><th>Last Status</th><th>Last Run</th></tr></thead><tbody>';
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        var status = j.last_status || "never";
        var statusClass = status === "error" ? "err" : status === "success" ? "ok" : "";
        html += "<tr>" +
          "<td>" + escape(j.name || j.id || "—") + "</td>" +
          "<td>" + escape(j.schedule || "—") + "</td>" +
          "<td>" + (j.enabled !== false ? "✓" : "✗") + "</td>" +
          '<td><span class="mon-badge mon-badge--' + statusClass + '">' + escape(status) + "</span></td>" +
          "<td>" + ago(j.last_run_at) + "</td>" +
          "</tr>";
      }
      html += "</tbody></table>";
      return html;
    }

    function loadAll() {
      setState({ loading: true, error: null });
      api("/summary").then(function (d) {
        state.summary = d;
        return api("/metrics");
      }).then(function (d) {
        state.metrics = d;
        return api("/alerts");
      }).then(function (d) {
        state.alerts = d;
        state.loading = false;
        renderView();
      }).catch(function (e) {
        state.loading = false;
        state.error = e.message || String(e);
        renderView();
      });
    }

    window.addEventListener("hashchange", renderView);
    loadAll();
    renderView();
  }

  var mount = document.getElementById("plugin-mount") || document.querySelector("[data-plugin=monitoring]");
  if (!mount) {
    var observer = new MutationObserver(function () {
      mount = document.getElementById("plugin-mount") || document.querySelector("[data-plugin=monitoring]");
      if (mount) { observer.disconnect(); render(mount); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return;
  }
  render(mount);
>>>>>>> 2437ffe (auto: daily commit 2026-06-16 21:00:01)
})();
