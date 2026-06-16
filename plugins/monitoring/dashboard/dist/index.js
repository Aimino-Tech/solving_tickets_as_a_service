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
})();
