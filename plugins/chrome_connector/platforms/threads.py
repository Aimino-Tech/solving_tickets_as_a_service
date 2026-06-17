"""Threads (Instagram) CDP handler — post, read, search via Chrome."""

from __future__ import annotations

import json
import time

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class ThreadsCDP:
    """Threads operations via Chrome DevTools Protocol (uses IG SSO)."""

    PLATFORM = "threads"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def post(self, text: str) -> dict:
        """Post to Threads."""
        self.manager.navigate(self.PLATFORM, "https://www.threads.net/")
        time.sleep(3)

        js = f"""
        (async () => {{
            // Click compose button
            const composeBtn = document.querySelector('[aria-label="Create"]');
            if (!composeBtn) return {{error: "Compose button not found"}};
            composeBtn.click();
            await new Promise(r => setTimeout(r, 2000));

            // Find editor
            const editor = document.querySelector('[contenteditable="true"]');
            if (!editor) return {{error: "Editor not found"}};

            editor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});
            await new Promise(r => setTimeout(r, 1000));

            // Click post button
            const postBtn = document.querySelector('[aria-label="Post"]');
            if (postBtn) postBtn.click();

            await new Promise(r => setTimeout(r, 3000));
            return {{success: true, action: "posted"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def read_thread(self, url: str) -> dict:
        """Read a Threads post by URL."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (() => {
            const content = document.querySelector('[data-pressable-container="true"]');
            const author = document.querySelector('a[href*="/@"]');
            const time = document.querySelector('time');

            return {
                author: author ? author.textContent.trim() : 'unknown',
                content: content ? content.textContent.trim() : '',
                time: time ? time.textContent.trim() : null,
            };
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, query: str) -> dict:
        """Search Threads."""
        url = f"https://www.threads.net/search?q={query}"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (() => {
            const results = [];
            const posts = document.querySelectorAll('[data-pressable-container="true"]');

            for (const post of posts) {
                const text = post.textContent.trim();
                if (text) {
                    results.push({content: text.slice(0, 300)});
                }
            }

            return {results: results.slice(0, 10), count: results.length};
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def comment(self, post_url: str, text: str) -> dict:
        """Comment on a Threads post."""
        self.manager.navigate(self.PLATFORM, post_url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Find comment/reply button
            const replyBtn = document.querySelector('[aria-label="Reply"]');
            if (!replyBtn) return {{error: "Reply button not found"}};
            replyBtn.click();
            await new Promise(r => setTimeout(r, 2000));

            const editor = document.querySelector('[contenteditable="true"]');
            if (!editor) return {{error: "Editor not found"}};

            editor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});
            await new Promise(r => setTimeout(r, 500));

            const postBtn = document.querySelector('[aria-label="Post"]');
            if (postBtn) postBtn.click();

            await new Promise(r => setTimeout(r, 2000));
            return {{success: true, action: "commented"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def is_logged_in(self) -> bool:
        """Check if logged into Threads (via IG SSO)."""
        js = """
        (() => {
            const profile = document.querySelector('a[href*="/@"]');
            const loginBtn = document.querySelector('a[href*="/login"]');
            return {logged_in: !!profile && !loginBtn};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
