"""
Campaign Dashboard — Slack Interactive Version
Sends interactive messages with Approve/Deny buttons for each pending action.
"""
import json, os, time

DATA_FILE = os.path.join(os.path.dirname(__file__), 'campaign-items.json')

def load_items():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_items(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def build_pending_message(item):
    """Build a Slack Block Kit message for a pending item with approve/deny buttons."""
    platform_emoji = {
        'reddit': '🔴', 'twitter': '🐦', 'facebook': '📘',
        'instagram': '📸', 'threads': '🧵'
    }
    emoji = platform_emoji.get(item['platform'], '📍')
    action_label = {
        'comment': '💬 Comment on', 'post': '📝 Post in', 'thread': '🧵 Thread on',
        'tweet': '🐦 Tweet', 'reply': '↩️ Reply to'
    }.get(item['action'], item['action'])
    
    return {
        "channel": "C0B48PJHSCX",
        "text": f"New campaign action: {action_label} {item['community']}",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{emoji} *Proposed Action*  |  {item['platform'].upper()}  |  {item['community']}"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{action_label}*\n>_{item['content'][:200]}_\n\n*Notes:* {item.get('notes', '—')}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Approve"},
                        "style": "primary",
                        "value": f"approve:{item['id']}",
                        "action_id": f"approve_{item['id']}"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "❌ Deny"},
                        "style": "danger",
                        "value": f"deny:{item['id']}",
                        "action_id": f"deny_{item['id']}"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✏️ Edit"},
                        "style": "default",
                        "value": f"edit:{item['id']}",
                        "action_id": f"edit_{item['id']}"
                    }
                ]
            },
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"🆔 `{item['id']}`  |  Proposed: {item['proposed']}"}
                ]
            }
        ]
    }

def build_summary_message(items):
    """Build a summary message showing counts of pending/approved/done items."""
    pending = [i for i in items if i['status'] == 'pending']
    approved = [i for i in items if i['status'] == 'approved']
    done = [i for i in items if i['status'] == 'done']
    
    summary = f"*🚀 Campaign Dashboard — Summary*\n\n"
    summary += f"⏳ *Pending:* {len(pending)}\n"
    summary += f"✅ *Approved:* {len(approved)}\n"
    summary += f"✔️ *Done:* {len(done)}\n"
    summary += f"📊 *Total:* {len(items)}\n\n"
    
    if pending:
        summary += "*Pending Actions:*\n"
        for p in pending[:10]:
            emoji = {'reddit': '🔴', 'twitter': '🐦', 'facebook': '📘', 'instagram': '📸', 'threads': '🧵'}.get(p['platform'], '📍')
            summary += f"  {emoji} `{p['id']}` {p['community']} — {p['content'][:60]}...\n"
    
    return {
        "channel": "C0B48PJHSCX",
        "text": "Campaign Dashboard Summary",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": summary
                }
            }
        ]
    }

def propose_action(platform, community, action, content, notes=""):
    """Add a new proposed action to the dashboard."""
    data = load_items()
    
    # Generate ID
    prefix = {'reddit': 'rdt', 'twitter': 'x', 'facebook': 'fb', 'instagram': 'ig', 'threads': 'thr'}.get(platform, 'act')
    existing = [i for i in data['items'] if i['id'].startswith(prefix)]
    num = len(existing) + 1
    item_id = f"{prefix}-{num:03d}"
    
    new_item = {
        "id": item_id,
        "platform": platform,
        "community": community,
        "action": action,
        "status": "pending",
        "proposed": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "content": content[:500],
        "url": "",
        "notes": notes
    }
    
    data['items'].append(new_item)
    save_items(data)
    return new_item

if __name__ == "__main__":
    # Test: Print a pending message (Slack Block Kit JSON)
    test_item = {
        "id": "test-001",
        "platform": "reddit",
        "community": "r/mcp",
        "action": "comment",
        "status": "pending",
        "proposed": "2026-05-19T16:00:00Z",
        "content": "Test comment about fast-html-mcp on a new thread.",
        "notes": "Test proposal"
    }
    
    msg = build_pending_message(test_item)
    print(json.dumps(msg, indent=2))
    
    # Test summary
    items = load_items()
    summary = build_summary_message(items['items'])
    print("\n\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))
