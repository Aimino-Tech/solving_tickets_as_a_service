"""LinkedIn CDP handler — post, read, search via Chrome."""

from __future__ import annotations

import json
import time

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class LinkedInCDP:
    """LinkedIn operations via Chrome DevTools Protocol."""

    PLATFORM = "linkedin"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def post(self, text: str) -> dict:
        """Post to LinkedIn feed."""
        self.manager.navigate(self.PLATFORM, "https://www.linkedin.com/feed/")
        time.sleep(3)

        js = f"""
        (async () => {{
            // Click "Start a post" button
            const startBtn = document.querySelector('button.share-box-feed-entry__trigger');
            if (!startBtn) return {{error: "Start post button not found"}};
            startBtn.click();
            await new Promise(r => setTimeout(r, 2000));

            // Find the editor
            const editor = document.querySelector('.ql-editor[data-placeholder]');
            if (!editor) return {{error: "Editor not found"}};

            editor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});
            await new Promise(r => setTimeout(r, 1000));

            // Click post button
            const postBtn = document.querySelector('button.share-actions__primary-action');
            if (postBtn) postBtn.click();

            await new Promise(r => setTimeout(r, 3000));
            return {{success: true, action: "posted"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def read_post(self, url: str) -> dict:
        """Read a LinkedIn post by URL."""
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (() => {
            const content = document.querySelector('.feed-shared-update-v2__description');
            const author = document.querySelector('.feed-shared-actor__name');
            const time = document.querySelector('.feed-shared-actor__subtitle');

            return {
                author: author ? author.textContent.trim() : 'unknown',
                content: content ? content.textContent.trim() : '',
                time: time ? time.textContent.trim() : null,
            };
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, query: str) -> dict:
        """Search LinkedIn."""
        url = f"https://www.linkedin.com/search/results/all/?keywords={query}"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = """
        (() => {
            const results = [];
            const cards = document.querySelectorAll('.reusable-search__result-container');

            for (const card of cards) {
                const title = card.querySelector('.entity-result__title-text');
                const subtitle = card.querySelector('.entity-result__primary-subtitle');
                const description = card.querySelector('.entity-result__secondary-subtitle');

                if (title) {
                    results.push({
                        title: title.textContent.trim(),
                        subtitle: subtitle ? subtitle.textContent.trim() : '',
                        description: description ? description.textContent.trim() : '',
                    });
                }
            }

            return {results: results, count: results.length};
        })()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def comment(self, post_url: str, text: str) -> dict:
        """Comment on a LinkedIn post."""
        self.manager.navigate(self.PLATFORM, post_url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Find comment input
            const commentBox = document.querySelector('.comments-comment-box__input');
            if (!commentBox) return {{error: "Comment box not found"}};

            commentBox.click();
            await new Promise(r => setTimeout(r, 500));

            const editor = document.querySelector('.ql-editor[contenteditable="true"]');
            if (!editor) return {{error: "Comment editor not found"}};

            editor.focus();
            document.execCommand('insertText', false, {json.dumps(text)});
            await new Promise(r => setTimeout(r, 500));

            // Click comment button
            const btn = document.querySelector('.comments-comment-box__submit-button');
            if (btn) btn.click();

            await new Promise(r => setTimeout(r, 2000));
            return {{success: true, action: "commented"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def is_logged_in(self) -> bool:
        """Check if logged into LinkedIn."""
        js = """
        (() => {
            const nav = document.querySelector('.global-nav__me');
            return {logged_in: !!nav};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
