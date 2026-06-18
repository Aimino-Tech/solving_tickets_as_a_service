// Tweet engagement extraction function
// Call this after navigating to a tweet page
function extractTweetMetrics() {
  const art = document.querySelector('article');
  if (!art) return JSON.stringify({error: 'no article found'});
  
  const btns = art.querySelectorAll('button');
  const btnData = Array.from(btns).map(b => ({
    text: b.textContent.trim(),
    ariaLabel: b.getAttribute('aria-label') || ''
  }));

  // Find views
  const viewsLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Views'));
  const views = viewsLink ? parseInt(viewsLink.textContent.replace(/[^0-9]/g, '')) : 0;

  // Parse buttons
  let replies = 0, retweets = 0, likes = 0;
  
  for (let i = 0; i < btnData.length; i++) {
    const b = btnData[i];
    if (b.ariaLabel === 'Reply' && i + 1 < btnData.length) {
      const next = btnData[i + 1];
      if (/^\d+$/.test(next.ariaLabel)) replies = parseInt(next.ariaLabel);
    }
    if (b.ariaLabel === 'Repost' && i + 1 < btnData.length) {
      const next = btnData[i + 1];
      if (/^\d+$/.test(next.ariaLabel)) retweets = parseInt(next.ariaLabel);
    }
    if (b.ariaLabel === 'Like' && i + 1 < btnData.length) {
      const next = btnData[i + 1];
      if (/^\d+$/.test(next.ariaLabel)) likes = parseInt(next.ariaLabel);
    }
  }

  return JSON.stringify({views, replies, retweets, likes});
}
return extractTweetMetrics();
