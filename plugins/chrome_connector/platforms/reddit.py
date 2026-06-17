"""Reddit CDP handler — post, read, search, comment via Chrome."""

from __future__ import annotations

import json
import time

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class RedditCDP:
    """Reddit operations via Chrome DevTools Protocol."""

    PLATFORM = "reddit"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def read_thread(self, url: str) -> dict:
        """Read a Reddit thread by URL."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (async () => {
            // Expand comments
            for (let i = 0; i < 3; i++) {
                window.scrollBy(0, 1500);
                await new Promise(r => setTimeout(r, 1000));
            }

            // Extract post
            const postTitle = document.querySelector('h1');
            const postBody = document.querySelector('[data-click-id="text"]');
            const postAuthor = document.querySelector('.author');

            // Extract comments
            const comments = [];
            const commentElements = document.querySelectorAll('.Comment');

            for (const el of commentElements) {
                const author = el.querySelector('.author');
                const body = el.querySelector('.md');
                const score = el.querySelector('.score');

                if (body) {
                    comments.push({
                        author: author ? author.textContent.trim() : 'unknown',
                        text: body.textContent.trim(),
                        score: score ? score.textContent.trim() : null,
                    });
                }
            }

            return {
                title: postTitle ? postTitle.textContent.trim() : '',
                body: postBody ? postBody.textContent.trim() : '',
                author: postAuthor ? postAuthor.textContent.trim() : 'unknown',
                comments: comments,
                comment_count: comments.length,
            };
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def post_comment(self, url: str, text: str) -> dict:
        """Post a comment on a Reddit thread."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Find comment textarea
            const textarea = document.querySelector('textarea[name="text"]');
            if (!textarea) return {{error: "Comment textarea not found"}};

            // Use React-compatible input
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            nativeInputValueSetter.call(textarea, {json.dumps(text)});
            textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
            textarea.dispatchEvent(new Event('change', {{ bubbles: true }}));

            await new Promise(r => setTimeout(r, 1000));

            // Click comment button
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();

            await new Promise(r => setTimeout(r, 3000));
            return {{success: true, action: "commented"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, query: str, subreddit: str = None) -> dict:
        """Search Reddit."""
        if subreddit:
            url = f"https://www.reddit.com/r/{subreddit}/search/?q={query}"
        else:
            url = f"https://www.reddit.com/search/?q={query}"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (async () => {
            for (let i = 0; i < 3; i++) {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 1000));
            }

            const results = [];
            const posts = document.querySelectorAll('article, [data-testid="post-container"]');

            for (const post of posts) {
                const title = post.querySelector('h3, [slot="title"]');
                const body = post.querySelector('[data-click-id="text"]');
                const link = post.querySelector('a[href*="/comments/"]');
                const subreddit = post.querySelector('.subreddit-name, [data-testid="subreddit-link"]');

                if (title) {
                    results.push({
                        title: title.textContent.trim(),
                        body: body ? body.textContent.trim().slice(0, 200) : '',
                        url: link ? link.href : null,
                        subreddit: subreddit ? subreddit.textContent.trim() : null,
                    });
                }
            }

            return {results: results, count: results.length};
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def is_logged_in(self) -> bool:
        """Check if logged into Reddit."""
        js = """
        (() => {
            const userMenu = document.querySelector('[data-testid="user-dropdown"]');
            const loginBtn = document.querySelector('a[href="/login"]');
            return {logged_in: !!userMenu && !loginBtn};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
