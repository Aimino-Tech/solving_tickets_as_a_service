"""Instagram Graph API client for content publishing.

Uses the Meta Graph API with container→publish flow:
1. POST /{ig-user-id}/media → creation_id (container)
2. POST /{ig-user-id}/media_publish → publish container
3. Supports IMAGE, VIDEO, REEL, CAROUSEL
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

import httpx

META_GRAPH_API = "https://graph.facebook.com/v21.0"
INSTAGRAM_USER_ID = os.getenv("INSTAGRAM_USER_ID", "")
INSTAGRAM_ACCESS_TOKEN = os.getenv("INSTAGRAM_ACCESS_TOKEN", "")

MAX_RETRIES = 3
RETRY_DELAY = 2
POLL_INTERVAL = 5
POLL_TIMEOUT = 120


def _client() -> httpx.Client:
    return httpx.Client(timeout=60)


def _log(platform: str, action: str, status: str, **kwargs):
    try:
        from engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, **kwargs)
    except Exception:
        pass


def create_image_container(
    image_url: str,
    caption: str = "",
    location_id: str = None,
    user_tags: list[dict] = None,
) -> dict:
    params = {
        "image_url": image_url,
        "caption": caption,
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }
    if location_id:
        params["location_id"] = location_id
    if user_tags:
        params["user_tags"] = json.dumps(user_tags)

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{INSTAGRAM_USER_ID}/media",
                    params=params,
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("instagram", "create_container", "success",
                     media_type="image", content_preview=caption[:200],
                     metadata={"container_id": data.get("id")})
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("instagram", "create_container", "failed",
                 error_message=str(e), content_preview=caption[:200])
            raise


def create_video_container(
    video_url: str,
    caption: str = "",
    thumb_url: str = None,
    location_id: str = None,
    is_reel: bool = False,
) -> dict:
    media_type = "REELS" if is_reel else "VIDEO"
    params = {
        "media_type": media_type,
        "video_url": video_url,
        "caption": caption,
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }
    if thumb_url:
        params["thumb_url"] = thumb_url
    if location_id:
        params["location_id"] = location_id

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{INSTAGRAM_USER_ID}/media",
                    params=params,
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("instagram", "create_container", "success",
                     media_type=media_type.lower(),
                     content_preview=caption[:200],
                     metadata={"container_id": data.get("id")})
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            _log("instagram", "create_container", "failed",
                 error_message=str(e))
            raise


def create_carousel_container(
    children: list[str],
    caption: str = "",
) -> dict:
    params = {
        "media_type": "CAROUSEL",
        "children": json.dumps(children),
        "caption": caption,
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }

    for attempt in range(MAX_RETRIES):
        try:
            with _client() as client:
                resp = client.post(
                    f"{META_GRAPH_API}/{INSTAGRAM_USER_ID}/media",
                    params=params,
                )
                if resp.status_code == 429:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                _log("instagram", "create_carousel", "success",
                     content_preview=caption[:200],
                     metadata={"container_id": data.get("id")})
                return data
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            raise


def get_container_status(container_id: str) -> dict:
    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{container_id}",
            params={
                "fields": "id,status_code,error_message",
                "access_token": INSTAGRAM_ACCESS_TOKEN,
            },
        )
        resp.raise_for_status()
        return resp.json()


def publish_container(container_id: str) -> dict:
    with _client() as client:
        resp = client.post(
            f"{META_GRAPH_API}/{INSTAGRAM_USER_ID}/media_publish",
            params={
                "creation_id": container_id,
                "access_token": INSTAGRAM_ACCESS_TOKEN,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        _log("instagram", "publish", "success",
             platform_post_id=data.get("id"),
             metadata={"container_id": container_id})
        return data


def create_and_publish_image(
    image_url: str,
    caption: str = "",
    wait_for_ready: bool = True,
) -> dict:
    container = create_image_container(image_url, caption)
    container_id = container.get("id")
    if not container_id:
        raise RuntimeError(f"No container ID returned: {container}")

    if wait_for_ready:
        _wait_for_container_ready(container_id)

    return publish_container(container_id)


def create_and_publish_reel(
    video_url: str,
    caption: str = "",
    thumb_url: str = None,
    wait_for_ready: bool = True,
) -> dict:
    container = create_video_container(video_url, caption, thumb_url, is_reel=True)
    container_id = container.get("id")
    if not container_id:
        raise RuntimeError(f"No container ID returned: {container}")

    if wait_for_ready:
        _wait_for_container_ready(container_id)

    return publish_container(container_id)


def create_and_publish_video(
    video_url: str,
    caption: str = "",
    thumb_url: str = None,
    wait_for_ready: bool = True,
) -> dict:
    container = create_video_container(video_url, caption, thumb_url, is_reel=False)
    container_id = container.get("id")
    if not container_id:
        raise RuntimeError(f"No container ID returned: {container}")

    if wait_for_ready:
        _wait_for_container_ready(container_id)

    return publish_container(container_id)


def _wait_for_container_ready(container_id: str) -> dict:
    elapsed = 0
    while elapsed < POLL_TIMEOUT:
        status_data = get_container_status(container_id)
        status_code = status_data.get("status_code", "")
        if status_code == "FINISHED":
            return status_data
        if status_code == "ERROR":
            error_msg = status_data.get("error_message", "Unknown error")
            _log("instagram", "container_ready_check", "failed",
                 error_message=error_msg, metadata={"container_id": container_id})
            raise RuntimeError(f"Container processing failed: {error_msg}")
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
    raise TimeoutError(f"Container {container_id} not ready after {POLL_TIMEOUT}s")


def get_media(media_id: str) -> dict:
    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{media_id}",
            params={
                "fields": "id,media_type,media_url,permalink,caption,timestamp",
                "access_token": INSTAGRAM_ACCESS_TOKEN,
            },
        )
        resp.raise_for_status()
        return resp.json()


def get_user_media(limit: int = 25) -> list[dict]:
    with _client() as client:
        resp = client.get(
            f"{META_GRAPH_API}/{INSTAGRAM_USER_ID}/media",
            params={
                "fields": "id,media_type,media_url,permalink,caption,timestamp",
                "limit": limit,
                "access_token": INSTAGRAM_ACCESS_TOKEN,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])
