#!/usr/bin/env node
// HN Submit — Direct HTTP approach (no browser)
// Gets form token, then POSTs the submission

const https = require('https');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers,
      }
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        location: res.headers.location,
        cookies: (res.headers['set-cookie'] || []).join('; '),
        body: data,
        url: url,
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  const COOKIE = 'user=xdnaimino%268UhFfEetpNe34iQdNqaMjf66i9EsAyjW';
  const TITLE = 'Show HN: Fast HTML MCP — write HTML directly from AI agents';
  const URL = 'https://github.com/Aimino-Tech/fast-html-mcp';

  // Step 1: Get the submit page to retrieve fnid token
  console.log('[1] Fetching submit page...');
  const submitPage = await request('https://news.ycombinator.com/submit', {
    headers: { 'Cookie': COOKIE }
  });
  
  if (submitPage.body.includes('Sorry')) {
    console.log('❌ HN returned "Sorry." page');
    // Check if cookie works at all
    const frontPage = await request('https://news.ycombinator.com/', {
      headers: { 'Cookie': COOKIE }
    });
    console.log(`Front page len: ${frontPage.body.length}`);
    console.log(`Contains xdnaimino: ${frontPage.body.includes('xdnaimino')}`);
    console.log(`Contains login: ${frontPage.body.includes('login')}`);
    process.exit(1);
  }

  // Extract fnid
  const fnidMatch = submitPage.body.match(/<input[^>]*name="fnid"[^>]*value="([^"]+)"/);
  if (!fnidMatch) {
    console.log('❌ No fnid token found');
    console.log('Body sample:', submitPage.body.substring(0, 500));
    process.exit(1);
  }
  const fnid = fnidMatch[1];
  console.log(`✅ Got fnid: ${fnid.substring(0, 20)}...`);
  console.log(`✅ Logged in: ${submitPage.body.includes('xdnaimino')}`);
  console.log(`✅ Has form: ${submitPage.body.includes('input name="title"')}`);

  // Step 2: POST the submission
  console.log('[2] Submitting...');
  const postBody = `fnid=${encodeURIComponent(fnid)}&title=${encodeURIComponent(TITLE)}&url=${encodeURIComponent(URL)}`;
  
  const result = await request('https://news.ycombinator.com/submit', {
    method: 'POST',
    headers: {
      'Cookie': COOKIE,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://news.ycombinator.com',
      'Referer': 'https://news.ycombinator.com/submit',
    },
    body: postBody
  });

  console.log(`Submit status: ${result.status}`);
  console.log(`Location: ${result.location || '(none)'}`);
  
  if (result.location) {
    console.log(`✅ Submission link: https://news.ycombinator.com${result.location}`);
    console.log('=== SUCCESS ===');
  } else {
    console.log('Body sample:', (result.body || '').substring(0, 500));
    if (result.body.includes('Bad')) console.log('❌ Bad request');
    if (result.body.includes('too long')) console.log('❌ Title too long');
  }
}

main().catch(err => console.error('Error:', err.message));
