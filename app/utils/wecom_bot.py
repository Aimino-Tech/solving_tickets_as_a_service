import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from app.common.db import EngagementDB
from app.common.config import get_env, get_proxy

WECOM_CORP_ID = get_env("WECOM_CORP_ID")
WECOM_AGENT_ID = get_env("WECOM_AGENT_ID")
WECOM_CORP_SECRET = get_env("WECOM_CORP_SECRET")
WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin"
PROXY_URL = get_proxy()

db = EngagementDB()


def _get_token():
    with httpx.Client(timeout=30, proxy=PROXY_URL) as client:
        resp = client.get(f"{WECOM_API_BASE}/gettoken",
                          params={"corpid": WECOM_CORP_ID, "corpsecret": WECOM_CORP_SECRET})
        resp.raise_for_status()
        data = resp.json()
        if data.get("errcode") != 0:
            raise Exception(f"Token error: {data.get('errmsg')}")
        return data["access_token"]


def send_text(content, to_user="@all"):
    token = _get_token()
    msg = {
        "touser": to_user,
        "msgtype": "text",
        "agentid": int(WECOM_AGENT_ID),
        "text": {"content": content},
        "safe": 0,
    }
    with httpx.Client(timeout=30, proxy=PROXY_URL) as client:
        resp = client.post(f"{WECOM_API_BASE}/message/send?access_token={token}", json=msg)
        resp.raise_for_status()
        result = resp.json()
        if result.get("errcode") == 0:
            db.log("wecom", "send_text", "success", {"msgid": result.get("msgid")}, "zh_CN")
        return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="WeCom bot")
    sub = parser.add_subparsers(dest="command", required=True)
    p_send = sub.add_parser("send")
    p_send.add_argument("--content", required=True)
    p_send.add_argument("--to", default="@all")
    args = parser.parse_args()
    if args.command == "send":
        print(json.dumps(send_text(args.content, args.to), indent=2))
