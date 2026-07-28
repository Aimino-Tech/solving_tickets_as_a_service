import { Router, type Request, type Response } from 'express';

const router: Router = Router();

router.get('/monitoring', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>STAS Monitoring</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .live-dot { animation: pulse 2s infinite; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 font-mono">
  <nav class="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-lg">⚡</span>
      <h1 class="text-lg font-bold">STAS Monitoring</h1>
      <span id="liveBadge" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400 border border-green-800">
        <span class="live-dot w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
        LIVE
      </span>
    </div>
    <div class="text-xs text-gray-500">
      <span id="clock"></span>
    </div>
  </nav>

  <div class="max-w-6xl mx-auto p-6 space-y-6">

    <!-- Status Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="statusCards">
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Status</div>
        <div id="overallStatus" class="text-2xl font-bold mt-1 text-green-400">—</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Last Run</div>
        <div id="lastRun" class="text-sm font-bold mt-1 text-gray-300">—</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Log File</div>
        <div id="logFileSize" class="text-sm font-bold mt-1 text-gray-300">—</div>
        <div id="logFilePath" class="text-[10px] text-gray-600 mt-0.5 truncate"></div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Next Scan</div>
        <div id="nextScan" class="text-sm font-bold mt-1 text-gray-300">10s</div>
      </div>
    </div>

    <!-- Error Counts -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Log Errors</div>
          <span class="text-yellow-400 text-lg">⚠</span>
        </div>
        <div id="totalLogErrors" class="text-3xl font-bold mt-1 text-yellow-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Webhook Failures</div>
          <span class="text-red-400 text-lg">✕</span>
        </div>
        <div id="totalWebhookErrors" class="text-3xl font-bold mt-1 text-red-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Run Failures</div>
          <span class="text-orange-400 text-lg">!</span>
        </div>
        <div id="totalRunErrors" class="text-3xl font-bold mt-1 text-orange-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Tickets Created</div>
          <span class="text-blue-400 text-lg">▶</span>
        </div>
        <div id="totalTicketsCreated" class="text-3xl font-bold mt-1 text-blue-400">0</div>
      </div>
    </div>

    <!-- Latest Error -->
    <div class="bg-gray-900 rounded-xl p-4 border border-gray-800" id="lastErrorSection" style="display:none">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Last Error</div>
      <pre id="lastError" class="text-xs text-red-400 bg-gray-950 rounded-lg p-3 overflow-x-auto"></pre>
    </div>

    <!-- Activity Log -->
    <div class="bg-gray-900 rounded-xl border border-gray-800">
      <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <span class="text-xs text-gray-500 uppercase tracking-wide">Activity</span>
        <span class="text-xs text-gray-600">Auto-refresh 10s</span>
      </div>
      <div class="p-4 max-h-64 overflow-y-auto" id="activityLog">
        <div class="text-center text-gray-600 text-sm py-8">Waiting for data...</div>
      </div>
    </div>
  </div>

  <script>
    const ACTIVITIES = [];
    const MAX_ACTIVITIES = 50;

    function addActivity(type, msg) {
      const time = new Date().toLocaleTimeString();
      ACTIVITIES.unshift({ time, type, msg });
      if (ACTIVITIES.length > MAX_ACTIVITIES) ACTIVITIES.pop();
      renderActivities();
    }

    function renderActivities() {
      const el = document.getElementById('activityLog');
      if (ACTIVITIES.length === 0) {
        el.innerHTML = '<div class="text-center text-gray-600 text-sm py-8">Waiting for data...</div>';
        return;
      }
      el.innerHTML = ACTIVITIES.map(a => {
        const colors = {
          info: 'text-blue-400',
          error: 'text-red-400',
          ticket: 'text-green-400',
          scan: 'text-gray-400'
        };
        return \`<div class="flex gap-3 text-xs py-1 border-b border-gray-800/50">
          <span class="text-gray-600 shrink-0">\${a.time}</span>
          <span class="\${colors[a.type] || 'text-gray-400'}">\${a.msg}</span>
        </div>\`;
      }).join('');
    }

    function updateClock() {
      document.getElementById('clock').textContent = new Date().toLocaleString();
    }

    function fmtBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/monitoring/status');
        const d = await res.json();

        // Overall Status
        const statusEl = document.getElementById('overallStatus');
        const badge = document.getElementById('liveBadge');
        if (d.status === 'running') {
          statusEl.textContent = 'SCANNING';
          statusEl.className = 'text-2xl font-bold mt-1 text-yellow-400';
          badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800';
        } else if (d.status === 'idle') {
          statusEl.textContent = 'IDLE';
          statusEl.className = 'text-2xl font-bold mt-1 text-green-400';
          badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400 border border-green-800';
        } else {
          statusEl.textContent = d.status.toUpperCase();
          statusEl.className = 'text-2xl font-bold mt-1 text-gray-500';
        }

        document.getElementById('lastRun').textContent = d.lastRunAt ? new Date(d.lastRunAt).toLocaleTimeString() : '—';
        document.getElementById('logFileSize').textContent = d.logFileSize ? fmtBytes(d.logFileSize) : '—';
        document.getElementById('logFilePath').textContent = d.logFilePath || '—';

        document.getElementById('totalLogErrors').textContent = d.totalLogErrors || 0;
        document.getElementById('totalWebhookErrors').textContent = d.totalWebhookErrors || 0;
        document.getElementById('totalRunErrors').textContent = d.totalRunErrors || 0;
        document.getElementById('totalTicketsCreated').textContent = d.totalTicketsCreated || 0;

        // Last Error
        const errSection = document.getElementById('lastErrorSection');
        const errEl = document.getElementById('lastError');
        if (d.lastError) {
          errSection.style.display = 'block';
          errEl.textContent = d.lastError;
        } else {
          errSection.style.display = 'none';
        }

        // Add activity on changes
        if (d.totalTicketsCreated > 0 && !window._lastTickets) {
          addActivity('ticket', \`Created \${d.totalTicketsCreated} ticket(s)\`);
        }
        window._lastTickets = d.totalTicketsCreated;

      } catch (err) {
        addActivity('error', 'Failed to fetch status: ' + err.message);
      }
    }

    // Init
    updateClock();
    setInterval(updateClock, 1000);
    fetchStatus();
    setInterval(fetchStatus, 10000);
    addActivity('info', 'Monitoring dashboard loaded');
  </script>
</body>
</html>`);
});

export { router as monitoringUiRouter };

export const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>STAS Monitoring</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .live-dot { animation: pulse 2s infinite; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 font-mono">
  <nav class="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-lg">⚡</span>
      <h1 class="text-lg font-bold">STAS Monitoring</h1>
      <span id="liveBadge" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400 border border-green-800">
        <span class="live-dot w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
        LIVE
      </span>
    </div>
    <div class="text-xs text-gray-500">
      <span id="clock"></span>
    </div>
  </nav>

  <div class="max-w-6xl mx-auto p-6 space-y-6">

    <!-- Status Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="statusCards">
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Status</div>
        <div id="overallStatus" class="text-2xl font-bold mt-1 text-green-400">—</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Last Run</div>
        <div id="lastRun" class="text-sm font-bold mt-1 text-gray-300">—</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Log File</div>
        <div id="logFileSize" class="text-sm font-bold mt-1 text-gray-300">—</div>
        <div id="logFilePath" class="text-[10px] text-gray-600 mt-0.5 truncate"></div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Next Scan</div>
        <div id="nextScan" class="text-sm font-bold mt-1 text-gray-300">10s</div>
      </div>
    </div>

    <!-- Error Counts -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Log Errors</div>
          <span class="text-yellow-400 text-lg">⚠</span>
        </div>
        <div id="totalLogErrors" class="text-3xl font-bold mt-1 text-yellow-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Webhook Failures</div>
          <span class="text-red-400 text-lg">✕</span>
        </div>
        <div id="totalWebhookErrors" class="text-3xl font-bold mt-1 text-red-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Run Failures</div>
          <span class="text-orange-400 text-lg">!</span>
        </div>
        <div id="totalRunErrors" class="text-3xl font-bold mt-1 text-orange-400">0</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Tickets Created</div>
          <span class="text-blue-400 text-lg">▶</span>
        </div>
        <div id="totalTicketsCreated" class="text-3xl font-bold mt-1 text-blue-400">0</div>
      </div>
    </div>

    <!-- Latest Error -->
    <div class="bg-gray-900 rounded-xl p-4 border border-gray-800" id="lastErrorSection" style="display:none">
      <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Last Error</div>
      <pre id="lastError" class="text-xs text-red-400 bg-gray-950 rounded-lg p-3 overflow-x-auto"></pre>
    </div>

    <!-- Activity Log -->
    <div class="bg-gray-900 rounded-xl border border-gray-800">
      <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <span class="text-xs text-gray-500 uppercase tracking-wide">Activity</span>
        <span class="text-xs text-gray-600">Auto-refresh 10s</span>
      </div>
      <div class="p-4 max-h-64 overflow-y-auto" id="activityLog">
        <div class="text-center text-gray-600 text-sm py-8">Waiting for data...</div>
      </div>
    </div>
  </div>

  <script>
    const ACTIVITIES = [];
    const MAX_ACTIVITIES = 50;

    function addActivity(type, msg) {
      const time = new Date().toLocaleTimeString();
      ACTIVITIES.unshift({ time, type, msg });
      if (ACTIVITIES.length > MAX_ACTIVITIES) ACTIVITIES.pop();
      renderActivities();
    }

    function renderActivities() {
      const el = document.getElementById('activityLog');
      if (ACTIVITIES.length === 0) {
        el.innerHTML = '<div class="text-center text-gray-600 text-sm py-8">Waiting for data...</div>';
        return;
      }
      el.innerHTML = ACTIVITIES.map(a => {
        const colors = { info: 'text-blue-400', error: 'text-red-400', ticket: 'text-green-400', scan: 'text-gray-400' };
        return \`<div class="flex gap-3 text-xs py-1 border-b border-gray-800/50">
          <span class="text-gray-600 shrink-0">\${a.time}</span>
          <span class="\${colors[a.type] || 'text-gray-400'}">\${a.msg}</span>
        </div>\`;
      }).join('');
    }

    function updateClock() {
      document.getElementById('clock').textContent = new Date().toLocaleString();
    }

    function fmtBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/monitoring/status');
        const d = await res.json();

        const statusEl = document.getElementById('overallStatus');
        const badge = document.getElementById('liveBadge');
        if (d.status === 'running') {
          statusEl.textContent = 'SCANNING';
          statusEl.className = 'text-2xl font-bold mt-1 text-yellow-400';
          badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800';
        } else if (d.status === 'idle') {
          statusEl.textContent = 'IDLE';
          statusEl.className = 'text-2xl font-bold mt-1 text-green-400';
          badge.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-green-900/50 text-green-400 border border-green-800';
        } else {
          statusEl.textContent = (d.status || '?').toUpperCase();
          statusEl.className = 'text-2xl font-bold mt-1 text-gray-500';
        }

        document.getElementById('lastRun').textContent = d.lastRunAt ? new Date(d.lastRunAt).toLocaleTimeString() : '—';
        document.getElementById('logFileSize').textContent = d.logFileSize ? fmtBytes(d.logFileSize) : '—';
        document.getElementById('logFilePath').textContent = d.logFilePath || '—';

        document.getElementById('totalLogErrors').textContent = d.totalLogErrors || 0;
        document.getElementById('totalWebhookErrors').textContent = d.totalWebhookErrors || 0;
        document.getElementById('totalRunErrors').textContent = d.totalRunErrors || 0;
        document.getElementById('totalTicketsCreated').textContent = d.totalTicketsCreated || 0;

        const errSection = document.getElementById('lastErrorSection');
        const errEl = document.getElementById('lastError');
        if (d.lastError) {
          errSection.style.display = 'block';
          errEl.textContent = d.lastError;
        } else {
          errSection.style.display = 'none';
        }

        if (d.totalTicketsCreated > 0 && !window._lastTickets) {
          addActivity('ticket', \`Created \${d.totalTicketsCreated} ticket(s)\`);
        }
        window._lastTickets = d.totalTicketsCreated;

      } catch (err) {
        addActivity('error', 'Failed to fetch status: ' + err.message);
      }
    }

    updateClock();
    setInterval(updateClock, 1000);
    fetchStatus();
    setInterval(fetchStatus, 10000);
    addActivity('info', 'Monitoring dashboard loaded');
  </script>
</body>
</html>`;
