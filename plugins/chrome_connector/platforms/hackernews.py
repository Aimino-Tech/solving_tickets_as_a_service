"""Hacker News CDP handler — post, read, comment via Chrome."""

from __future__ import annotations

import json
import time

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class HackerNewsCDP:
    """Hacker News operations via Chrome DevTools Protocol."""

    PLATFORM = "hackernews"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def post(self, title: str, url: str = None, text: str = None) -> dict:
        """Post to Hacker News."""
        self.manager.navigate(self.PLATFORM, "https://news.ycombinator.com/submit")
        time.sleep(2)

        js = f"""
        (async () => {{
            // Fill title
            const titleInput = document.querySelector('input[name="title"]');
            if (!titleInput) return {{error: "Title input not found"}};
            titleInput.value = {json.dumps(title)};
            titleInput.dispatchEvent(new Event('input', {{bubbles: true}}));

            // Fill URL or text
            const urlInput = document.querySelector('input[name="url"]');
            const textInput = document.querySelector('textarea[name="text"]');

            if ({json.dumps(url)} && urlInput) {{
                urlInput.value = {json.dumps(url)};
                urlInput.dispatchEvent(new Event('input', {{bubbles: true}}));
            }} else if ({json.dumps(text)} && textInput) {{
                textInput.value = {json.dumps(text)};
                textInput.dispatchEvent(new Event('input', {{bubbles: true}}));
            }}

            // Submit
            const submitBtn = document.querySelector('input[type="submit"]');
            if (submitBtn) submitBtn.click();

            await new Promise(r => setTimeout(r, 2000));
            return {{success: true, action: "posted"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def read_thread(self, url: str) -> dict:
        """Read an HN thread by URL."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(2)

        js = """
        (async () => {
            // Expand all comments
            const toggleBtns = document.querySelectorAll('.togg');
            for (const btn of toggleBtns) {
                if (btn.textContent.includes('[+]')) {
                    btn.click();
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            // Extract title
            const titleEl = document.querySelector('.titleline > a');

            // Extract comments
            const comments = [];
            const commentRows = document.querySelectorAll('.commtext');

            for (const row of commentRows) {
                const author = row.closest('.comtr')?.querySelector('.hnuser');
                comments.push({
                    author: author ? author.textContent.trim() : 'unknown',
                    text: row.textContent.trim(),
                });
            }

            return {
                title: titleEl ? titleEl.textContent.trim() : '',
                url: titleEl ? titleEl.href : null,
                comments: comments,
                comment_count: comments.length,
            };
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def post_comment(self, item_id: str, text: str) -> dict:
        """Post a comment on an HN item."""
        url = f"https://news.ycombinator.com/reply?id={item_id}"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(2)

        js = f"""
        (async () => {{
            const textarea = document.querySelector('textarea[name="text"]');
            if (!textarea) return {{error: "Textarea not found"}};

            textarea.value = {json.dumps(text)};
            textarea.dispatchEvent(new Event('input', {{bubbles: true}}));

            const submitBtn = document.querySelector('input[type="submit"]');
            if (submitBtn) submitBtn.click();

            await new Promise(r => setTimeout(r, 2000));
            return {{success: true, action: "commented"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, query: str) -> dict:
        """Search Hacker News via Algolia API."""
        import requests as req
        try:
            resp = req.get(
                "https://hn.algolia.com/api/v1/search",
                params={"query": query, "tags": "story"},
                timeout=10,
            )
            data = resp.json()
            results = []
            for hit in data.get("hits", [])[:10]:
                results.append({
                    "title": hit.get("title", ""),
                    "url": hit.get("url"),
                    "author": hit.get("author"),
                    "points": hit.get("points"),
                    "hn_url": f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
                })
            return {"results": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e)}

    def is_logged_in(self) -> bool:
        """Check if logged into Hacker News."""
        js = """
        (() => {
            const userLink = document.querySelector('a[href*="user?"]');
            const loginLink = document.querySelector('a[href*="login"]');
            return {logged_in: !!userLink && !loginLink};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
