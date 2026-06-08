"""Facebook Pages client using System User never-expiring Page Access Tokens.

API: Meta Graph API v21.0
Auth flow: System User → assigned to app → generates never-expiring Page Access Token.
Post: POST /{page-id}/feed with message + link fields.
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

import httpx

META_GRAPH_API = "https://graph.facebook.com/v21.0"
FACEBOOK_PAGE_ID = os.getenv("FACEBOOK_PAGE_ID", "")
FACEBOOK_PAGE_ACCESS_TOKEN = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "")
FACEBOOK_SYSTEM_USER_TOKEN = os.getenv("FACEBOOK_SYSTEM_USER_TOKEN", "")

MAX_RETRIES = 3
RETRY_DELAY = 2


def _get_token() -> str:
    return FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_SYSTEM_USER_TOKEN


def _client() -> httpx.Client:
    return httpx.Client(timeout=60)


def _log(platform: str, action: str, status: str, **kwargs):
    try:
        from engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, **kwargs)
    except Exception:
        pass


def post_text(message: str, page_id: str = None) -> dict:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{pid}/feed",
                    params={
                        "message": message,
                        "access_token": token,
                    },
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("facebook", "post_text", "success",
                     platform_post_id=data.get("id"),
                     content_preview=message[:200])
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("facebook", "post_text", "failed",
                 error_message=str(e), content_preview=message[:200])
            raise


def post_with_link(
    message: str,
    link: str,
    page_id: str = None,
) -> dict:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{pid}/feed",
                    params={
                        "message": message,
                        "link": link,
                        "access_token": token,
                    },
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("facebook", "post_with_link", "success",
                     platform_post_id=data.get("id"),
                     content_preview=message[:100],
                     metadata={"link": link})
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("facebook", "post_with_link", "failed",
                 error_message=str(e))
            raise


def post_photo(
    image_url: str,
    message: str = "",
    page_id: str = None,
) -> dict:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{pid}/photos",
                    params={
                        "url": image_url,
                        "message": message,
                        "access_token": token,
                    },
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("facebook", "post_photo", "success",
                     platform_post_id=data.get("id"),
                     media_url=image_url,
                     content_preview=message[:200])
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("facebook", "post_photo", "failed",
                 error_message=str(e))
            raise


def post_video(
    video_url: str,
    title: str = "",
    description: str = "",
    page_id: str = None,
) -> dict:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{pid}/videos",
                    params={
                        "file_url": video_url,
                        "title": title,
                        "description": description,
                        "access_token": token,
                    },
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("facebook", "post_video", "success",
                     platform_post_id=data.get("id"),
                     metadata={"title": title})
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("facebook", "post_video", "failed",
                 error_message=str(e))
            raise


def get_page_feed(limit: int = 25, page_id: str = None) -> list[dict]:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()

    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{pid}/feed",
            params={
                "fields": "id,message,created_time,permalink_url,attachments",
                "limit": limit,
                "access_token": token,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])


def get_post(post_id: str) -> dict:
    token = _get_token()
    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{post_id}",
            params={
                "fields": "id,message,created_time,permalink_url,attachments,likes.summary(true),comments.summary(true)",
                "access_token": token,
            },
        )
        resp.raise_for_status()
        return resp.json()


def delete_post(post_id: str) -> dict:
    token = _get_token()
    with _client() as client:
        resp = client.delete(
            f"{META_GRAPH_API}/{post_id}",
            params={"access_token": token},
        )
        resp.raise_for_status()
        data = resp.json()
        _log("facebook", "delete_post", "success", platform_post_id=post_id)
        return data


def list_pages() -> list[dict]:
    token = FACEBOOK_SYSTEM_USER_TOKEN or FACEBOOK_PAGE_ACCESS_TOKEN
    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/me/accounts",
            params={"access_token": token},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])


def get_page_insights(
    metric: str = "page_impressions,page_engagement,page_fans",
    period: str = "day",
    since: str = None,
    until: str = None,
    page_id: str = None,
) -> dict:
    pid = page_id or FACEBOOK_PAGE_ID
    token = _get_token()
    params = {
        "metric": metric,
        "period": period,
        "access_token": token,
    }
    if since:
        params["since"] = since
    if until:
        params["until"] = until

    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{pid}/insights",
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
