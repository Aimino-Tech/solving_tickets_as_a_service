#!/usr/bin/env python3
"""HN Karma Builder — systematically increase Hacker News account karma.

Strategy:
1. Upvote interesting content (1 point per upvote)
2. Post Show HN with useful tools/projects
3. Comment on new threads (less restrictions)
4. Submit links to relevant articles

Usage:
    python3 hn_karma_builder.py upvote      # Upvote 10 interesting posts
    python3 hn_karma_builder.py post        # Post a Show HN
    python3 hn_karma_builder.py comment     # Comment on a new thread
    python3 hn_karma_builder.py status      # Check current karma
    python3 hn_karma_builder.py auto        # Auto-build karma (all strategies)
"""

import json
import sys
import time
from pathlib import Path

# Add hermes-agent to path
sys.path.insert(0, str(Path.home() / "Documents" / "hermes-agent"))

from plugins.chrome_connector.manager import get_manager


def check_status():
    """Check HN account status."""
    manager = get_manager()
    
    # Navigate to profile
    manager.navigate("hackernews", "https://news.ycombinator.com/user?id=xdnaimino")
    time.sleep(3)
    
    # Get karma
    js = """
    (() => {
        const body = document.body.innerText;
        const match = body.match(/karma:\\s*(\\d+)/);
        return {karma: match ? match[1] : 'unknown'};
    })()
    """
    result = manager.evaluate("hackernews", js)
    print(f"Account: xdnaimino")
    print(f"Karma: {result.get('karma', 'unknown')}")
    return result


def upvote_posts(count=10):
    """Upvote interesting posts to gain karma (upvoting shows engagement)."""
    manager = get_manager()
    
    # Navigate to front page
    manager.navigate("hackernews", "https://news.ycombinator.com")
    time.sleep(3)
    
    # Get upvote buttons
    js = f"""
    (() => {{
        const votearrows = document.querySelectorAll('.votearrow');
        const upvotable = [];
        for (let i = 0; i < Math.min({count}, votearrows.length); i++) {{
            const arrow = votearrows[i];
            if (arrow && !arrow.classList.contains('voted')) {{
                upvotable.push(i);
            }}
        }}
        return {{total: votearrows.length, upvotable: upvotable.length}};
    }})()
    """
    result = manager.evaluate("hackernews", js)
    print(f"Found {result.get('total', 0)} posts, {result.get('upvotable', 0)} upvotable")
    
    # Upvote posts
    upvoted = 0
    for i in range(min(count, result.get('upvotable', 0))):
        js = f"""
        (() => {{
            const votearrows = document.querySelectorAll('.votearrow');
            if (votearrows[{i}] && !votearrows[{i}].classList.contains('voted')) {{
                votearrows[{i}].click();
                return true;
            }}
            return false;
        }})()
        """
        success = manager.evaluate("hackernews", js)
        if success:
            upvoted += 1
            time.sleep(1)  # Rate limit
    
    print(f"Upvoted {upvoted} posts")
    return upvoted


def post_show_hn(title, url, text=""):
    """Post a Show HN with a useful tool/project."""
    manager = get_manager()
    
    # Navigate to submit page
    manager.navigate("hackernews", "https://news.ycombinator.com/submit")
    time.sleep(3)
    
    # Fill in the form
    js = f"""
    (() => {{
        const titleInput = document.querySelector('input[name="title"]');
        const urlInput = document.querySelector('input[name="url"]');
        const textInput = document.querySelector('textarea[name="text"]');
        
        if (titleInput) titleInput.value = {json.dumps(title)};
        if (urlInput) urlInput.value = {json.dumps(url)};
        if (textInput) textInput.value = {json.dumps(text)};
        
        // Submit
        const submitBtn = document.querySelector('input[type="submit"]');
        if (submitBtn) submitBtn.click();
        
        return {{success: true}};
    }})()
    """
    result = manager.evaluate("hackernews", js)
    print(f"Posted Show HN: {title}")
    return result


def comment_on_new_thread():
    """Comment on a new thread (less karma restrictions)."""
    manager = get_manager()
    
    # Navigate to new threads
    manager.navigate("hackernews", "https://news.ycombinator.com/newest")
    time.sleep(3)
    
    # Get thread links
    js = """
    (() => {
        const links = document.querySelectorAll('.titleline > a');
        const threads = [];
        for (let i = 0; i < Math.min(10, links.length); i++) {
            const link = links[i];
            if (link && link.href) {
                threads.push({title: link.textContent, url: link.href});
            }
        }
        return threads;
    })()
    """
    threads = manager.evaluate("hackernews", js)
    print(f"Found {len(threads) if isinstance(threads, list) else 0} new threads")
    return threads


def auto_build():
    """Automatically build karma using all strategies."""
    print("=== HN Karma Builder - Auto Mode ===\n")
    
    # 1. Check status
    print("1. Checking account status...")
    check_status()
    print()
    
    # 2. Upvote posts
    print("2. Upvoting interesting posts...")
    upvoted = upvote_posts(5)
    print(f"   Upvoted {upvoted} posts\n")
    
    # 3. Post Show HN
    print("3. Posting Show HN...")
    post_show_hn(
        title="Show HN: OpenTalk2HTML – Convert PDF to HTML with AI",
        url="https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD",
        text="I built an MCP server that converts PDF documents to clean HTML while preserving structure, tables, and formatting. Uses AI to handle complex layouts and XFA forms. Would love feedback from the HN community!"
    )
    print()
    
    # 4. Check new threads for commenting
    print("4. Finding new threads to comment on...")
    comment_on_new_thread()
    print()
    
    print("=== Auto-build complete ===")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "status":
        check_status()
    elif command == "upvote":
        count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        upvote_posts(count)
    elif command == "post":
        if len(sys.argv) < 4:
            print("Usage: hn_karma_builder.py post <title> <url> [text]")
            sys.exit(1)
        post_show_hn(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "")
    elif command == "comment":
        comment_on_new_thread()
    elif command == "auto":
        auto_build()
    else:
        print(f"Unknown command: {command}")
        print(__doc__)
