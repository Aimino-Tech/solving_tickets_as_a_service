"""Discord CDP handler — read, search, post via Chrome."""

from __future__ import annotations

import json
import time

from plugins.chrome_connector.manager import ChromeProfileManager, get_manager


class DiscordCDP:
    """Discord operations via Chrome DevTools Protocol."""

    PLATFORM = "discord"

    def __init__(self, manager: ChromeProfileManager = None):
        self.manager = manager or get_manager()

    def read_channel(self, channel_url: str, limit: int = 20) -> dict:
        """Read messages from a Discord channel."""
        self.manager.navigate(self.PLATFORM, channel_url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Scroll to load messages
            for (let i = 0; i < 3; i++) {{
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 1000));
            }}

            const messages = [];
            const msgElements = document.querySelectorAll('[class*="message-"]');

            for (const msg of msgElements) {{
                if (messages.length >= {limit}) break;

                const author = msg.querySelector('[class*="username-"]');
                const content = msg.querySelector('[class*="messageContent-"]');
                const timestamp = msg.querySelector('[class*="timestamp-"]');

                if (content) {{
                    messages.push({{
                        author: author ? author.textContent.trim() : 'unknown',
                        content: content.textContent.trim(),
                        time: timestamp ? timestamp.textContent.trim() : null,
                    }});
                }}
            }}

            return {{messages: messages, count: messages.length}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def post_message(self, channel_url: str, text: str) -> dict:
        """Post a message to a Discord channel."""
        self.manager.navigate(self.PLATFORM, channel_url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Find message input
            const editor = document.querySelector('[class*="textArea-"][role="textbox"]');
            if (!editor) return {{error: "Message editor not found"}};

            editor.focus();

            // Use clipboard to paste text
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', {json.dumps(text)});
            const pasteEvent = new ClipboardEvent('paste', {{
                clipboardData: clipboardData,
                bubbles: true,
                cancelable: true,
            }});
            editor.dispatchEvent(pasteEvent);

            await new Promise(r => setTimeout(r, 500));

            // Press Enter to send
            editor.dispatchEvent(new KeyboardEvent('keydown', {{
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
            }}));

            await new Promise(r => setTimeout(r, 2000));
            return {{success: true, action: "sent"}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def search(self, server_id: str, query: str) -> dict:
        """Search within a Discord server."""
        url = f"https://discord.com/channels/{server_id}"
        self.manager.navigate(self.PLATFORM, url)
        time.sleep(3)

        js = f"""
        (async () => {{
            // Open search
            const searchBtn = document.querySelector('[aria-label="Search"]');
            if (!searchBtn) return {{error: "Search button not found"}};
            searchBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            const searchInput = document.querySelector('[class*="search-"][role="textbox"]');
            if (!searchInput) return {{error: "Search input not found"}};

            searchInput.focus();
            document.execCommand('insertText', false, {json.dumps(query)});
            searchInput.dispatchEvent(new KeyboardEvent('keydown', {{
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
            }}));

            await new Promise(r => setTimeout(r, 3000));

            // Extract results
            const results = [];
            const items = document.querySelectorAll('[class*="searchResult-"]');

            for (const item of items) {{
                const author = item.querySelector('[class*="username-"]');
                const content = item.querySelector('[class*="messageContent-"]');
                const channel = item.querySelector('[class*="channelName-"]');

                if (content) {{
                    results.push({{
                        author: author ? author.textContent.trim() : 'unknown',
                        content: content.textContent.trim(),
                        channel: channel ? channel.textContent.trim() : null,
                    }});
                }}
            }}

            return {{results: results, count: results.length}};
        }})()
        """
        return self.manager.evaluate(self.PLATFORM, js)

    def is_logged_in(self) -> bool:
        """Check if logged into Discord."""
        js = """
        (() => {
            // Check for Discord app elements
            const app = document.querySelector('[class*="app-"]');
            const loginForm = document.querySelector('[class*="login-"]');
            return {logged_in: !!app && !loginForm};
        })()
        """
        result = self.manager.evaluate(self.PLATFORM, js)
        if isinstance(result, dict):
            return result.get("logged_in", False)
        return False
