"""Twitter/X CDP handler — post, read, search via Chrome."""

from __future__ import annotations

import json
import time
from typing import Optional

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class TwitterCDP:
    """Twitter/X operations via Chrome DevTools Protocol."""

    PLATFORM = "twitter"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def post_tweet(self, text: str, reply_to: str = None) -> dict:
        """Post a tweet via CDP."""
        # Navigate to compose
        self.manager.navigate(self.PLATFORM, "https://x.com/compose/post")
        time.sleep(3)

        # Type tweet content
        js = f"""
        (async () => {{
            // Find the tweet input
            const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (!editor) return {{error: "Tweet editor not found"}};

            // Focus and type
            editor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});

            // Wait a bit for UI to update
            await new Promise(r => setTimeout(r, 500));

            // Click the tweet button
            const btn = document.querySelector('[data-testid="tweetButton"]');
            if (btn) btn.click();

            await new Promise(r => setTimeout(r, 2000));

            return {{success: true, action: "posted"}};
        }})()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        return result

    def read_thread(self, url: str) -> dict:
        """Read a Twitter thread by URL."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (async () => {
            // Scroll to load more
            for (let i = 0; i < 3; i++) {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 1000));
            }

            // Extract tweets
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const tweets = [];

            for (const article of articles) {
                const nameEl = article.querySelector('[data-testid="User-Name"]');
                const textEl = article.querySelector('[data-testid="tweetText"]');
                const timeEl = article.querySelector('time');

                if (textEl) {
                    tweets.push({
                        author: nameEl ? nameEl.textContent.trim() : 'unknown',
                        text: textEl.textContent.trim(),
                        time: timeEl ? timeEl.getAttribute('datetime') : null,
                    });
                }
            }

            return {tweets: tweets, count: tweets.length};
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, query: str, limit: int = 10) -> dict:
        """Search Twitter for a query."""
        url = f"https://x.com/search?q={query}&src=typed_query&f=live"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Scroll to load results
            for (let i = 0; i < 3; i++) {{
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 1000));
            }}

            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const results = [];
            const limit = {limit};

            for (const article of articles) {{
                if (results.length >= limit) break;

                const nameEl = article.querySelector('[data-testid="User-Name"]');
                const textEl = article.querySelector('[data-testid="tweetText"]');
                const timeEl = article.querySelector('time');
                const linkEl = article.querySelector('a[href*="/status/"]');

                if (textEl) {{
                    results.push({{
                        author: nameEl ? nameEl.textContent.trim() : 'unknown',
                        text: textEl.textContent.trim(),
                        time: timeEl ? timeEl.getAttribute('datetime') : null,
                        url: linkEl ? linkEl.href : null,
                    }});
                }}
            }}

            return {{results: results, count: results.length}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def post_comment(self, tweet_url: str, text: str) -> dict:
        """Post a reply to a tweet."""
        self.manager.navigate(self.PLATFORM, tweet_url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Find reply input
            const replyEditor = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (!replyEditor) return {{error: "Reply editor not found"}};

            replyEditor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});

            await new Promise(r => setTimeout(r, 500));

            // Click reply button
            const btn = document.querySelector('[data-testid="tweetButton"]');
            if (btn) btn.click();

            await new Promise(r => setTimeout(r, 2000));

            return {{success: true, action: "replied"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def is_logged_in(self) -> bool:
        """Check if logged into Twitter."""
        js = """
        (() => {
            const avatar = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
            return {logged_in: !!avatar};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
