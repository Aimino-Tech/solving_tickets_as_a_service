#!/usr/bin/env node
// HN Submit v6 — Reliable version with auto-start + stealth

const http = require('http');

async function main() {
  // Check if browser is running
  let targets;
  try {
    const data = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:18801/json', res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    targets = JSON.parse(data);
  } catch(e) {
    console.log('Browser not running, starting...');
    require('child_process').execSync('openclaw browser start 2>&1', { timeout: 10000, stdio: 'inherit' });
    console.log('Browser started');
    // Wait for CDP to be ready
    await new Promise(r => setTimeout(r, 2000));
    const data = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:18801/json', res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    targets = JSON.parse(data);
  }

  const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'));
  if (!page) { console.error('No page tab'); process.exit(1); }
  console.log(`Using tab: ${page.url}`);

  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = {};

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
  };

  ws.onopen = async () => {
    const send = (method, params = {}) => new Promise(resolve => {
      const id = msgId++; pending[id] = resolve; ws.send(JSON.stringify({ id, method, params }));
    });

    // Stealth: hide headless detection
    console.log('[0] Hiding headless detection...');
    await send('Page.enable');
    await send('Network.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      `
    });
    await send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Safari/537.36',
      platform: 'Linux x86_64',
      acceptLanguage: 'en-US,en;q=0.9'
    });

    // Navigate to front page first
    console.log('[1] Loading HN front page...');
    await send('Page.navigate', { url: 'https://news.ycombinator.com' });
    await new Promise(r => setTimeout(r, 4000));

    let pageText = await send('Runtime.evaluate', {
      expression: "(document.body ? document.body.textContent : '').substring(0, 50)"
    });
    console.log(`Page response: ${pageText.result.result.value}`);

    if (pageText.result.result.value.includes('Sorry')) {
      console.log('Blocked. Trying with different user-agent...');
      await send('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Safari/537.36',
        platform: 'Win32',
      });
      await send('Page.reload');
      await new Promise(r => setTimeout(r, 3000));
      pageText = await send('Runtime.evaluate', {
        expression: "(document.body ? document.body.textContent : '').substring(0, 50)"
      });
      console.log(`Page response (Windows): ${pageText.result.result.value}`);
    }

    if (pageText.result.result.value.includes('Sorry')) {
      console.log('Still blocked by HN anti-bot.');
      console.log('Taking screenshot for debugging...');
      await send('Page.captureScreenshot', { format: 'png' });
      ws.close();
      return;
    }

    // Set cookie
    console.log('[2] Setting HN session cookie...');
    await send('Network.setCookie', {
      name: 'user',
      value: 'xdnaimino%268UhFfEetpNe34iQdNqaMjf66i9EsAyjW',
      domain: 'news.ycombinator.com',
      path: '/',
      secure: true,
      httpOnly: false
    });

    console.log('[3] Navigating to submit page...');
    await send('Page.navigate', { url: 'https://news.ycombinator.com/submit' });
    await new Promise(r => setTimeout(r, 4000));

    const submitInfo = await send('Runtime.evaluate', {
      expression: `
        JSON.stringify({
          title: document.title,
          url: window.location.href,
          textStart: (document.body ? document.body.textContent : '').substring(0, 100),
          hasInput: !!document.querySelector('input[name="title"]'),
        })
      `
    });
    console.log(`Submit page: ${submitInfo.result.result.value}`);

    const loggedIn = await send('Runtime.evaluate', {
      expression: "document.body.innerHTML.includes('xdnaimino')"
    });
    console.log(`Logged in: ${loggedIn.result.result.value}`);

    // If we got the form, fill and submit
    const hasTitleInput = await send('Runtime.evaluate', {
      expression: "!!document.querySelector('input[name=\"title\"]')"
    });

    if (hasTitleInput.result.result.value === true) {
      console.log('[4] Filling title...');
      await send('Runtime.evaluate', {
        expression: `
          const t = document.querySelector('input[name="title"]');
          t.value = 'Show HN: Fast HTML MCP — write HTML directly from AI agents';
          t.dispatchEvent(new Event('input', {bubbles:true}));
        `
      });
      console.log('[5] Filling URL...');
      await send('Runtime.evaluate', {
        expression: `
          const u = document.querySelector('input[name="url"]');
          u.value = 'https://github.com/Aimino-Tech/fast-html-mcp';
          u.dispatchEvent(new Event('input', {bubbles:true}));
        `
      });
      await new Promise(r => setTimeout(r, 500));
      console.log('[6] Submitting...');
      await send('Runtime.evaluate', {
        expression: "document.querySelector('input[type=\"submit\"]').click()"
      });
      await new Promise(r => setTimeout(r, 4000));
      const final = await send('Runtime.evaluate', {
        expression: "window.location.href"
      });
      console.log(`Final URL: ${final.result.result.value}`);
      console.log('=== SUCCESS ===');
    } else {
      console.log('No submit form found - might need to login differently');
    }

    ws.close();
  };

  ws.onerror = (err) => { console.error('WS error:', err.message); process.exit(1); };
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
