"""YouTube Data API v3 client with resumable upload support.

API: https://developers.google.com/youtube/v3/docs
Quota: 1600 units/day (resumable upload ≈ 1600 units, one full upload/day max)
"""

import json
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
YOUTUBE_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3"
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
YOUTUBE_ACCESS_TOKEN = os.getenv("YOUTUBE_ACCESS_TOKEN", "")
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN", "")
YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")

CHUNK_SIZE = 8 * 1024 * 1024
MAX_RETRIES = 3
RETRY_DELAY = 2


def _headers(access_token: str = None) -> dict:
    token = access_token or YOUTUBE_ACCESS_TOKEN
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _client(access_token: str = None) -> httpx.Client:
    token = access_token or YOUTUBE_ACCESS_TOKEN
    return httpx.Client(headers=_headers(token), timeout=120)


def _log(platform: str, action: str, status: str, **kwargs):
    try:
        from engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, **kwargs)
    except Exception:
        pass


def refresh_access_token(refresh_token: str = None) -> dict:
    token = refresh_token or YOUTUBE_REFRESH_TOKEN
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": YOUTUBE_CLIENT_ID,
            "client_secret": YOUTUBE_CLIENT_SECRET,
            "refresh_token": token,
            "grant_type": "refresh_token",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def get_auth_url(redirect_uri: str, state: str = None) -> str:
    from urllib.parse import urlencode
    import uuid
    params = {
        "client_id": YOUTUBE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        "response_type": "code",
        "access_type": "offline",
        "state": state or str(uuid.uuid4()),
        "prompt": "consent",
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"


def exchange_code_for_token(auth_code: str, redirect_uri: str) -> dict:
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": auth_code,
            "client_id": YOUTUBE_CLIENT_ID,
            "client_secret": YOUTUBE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _get_upload_url(metadata: dict, access_token: str = None) -> str:
    token = access_token or YOUTUBE_ACCESS_TOKEN
    resp = httpx.post(
        f"{YOUTUBE_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status",
        json=metadata,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Upload-Content-Type": "video/*",
        },
        timeout=30,
    )
    resp.raise_for_status()
    upload_url = resp.headers.get("Location", "")
    if not upload_url:
        raise RuntimeError("No upload URL in response headers")
    return upload_url


def upload_video_resumable(
    file_path: str,
    title: str,
    description: str = "",
    tags: list[str] = None,
    category_id: str = "22",
    privacy_status: str = "public",
    access_token: str = None,
) -> dict:
    file_path = str(Path(file_path).resolve())
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    file_size = os.path.getsize(file_path)

    metadata = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }

    upload_url = _get_upload_url(metadata, access_token)

    video_id = None
    with open(file_path, "rb") as f:
        chunk_index = 0
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break

            start_byte = chunk_index * CHUNK_SIZE
            end_byte = start_byte + len(chunk) - 1
            content_range = f"bytes {start_byte}-{end_byte}/{file_size}"

            for attempt in range(MAX_RETRIES):
                try:
                    resp = httpx.put(
                        upload_url,
                        content=chunk,
                        headers={
                            "Content-Length": str(len(chunk)),
                            "Content-Range": content_range,
                            "Authorization": f"Bearer {access_token or YOUTUBE_ACCESS_TOKEN}",
                        },
                        timeout=300,
                    )
                    if resp.status_code in (200, 201):
                        video_id = resp.json().get("id", "")
                        break
                    if resp.status_code == 308:
                        break
                    resp.raise_for_status()
                except (httpx.HTTPStatusError, httpx.RequestError) as e:
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(RETRY_DELAY * (attempt + 1))
                        continue
                    raise

            chunk_index += 1

    if not video_id:
        raise RuntimeError("Upload completed but no video ID returned")

    _log("youtube", "upload_video", "success",
         media_type="video", media_url=file_path,
         platform_post_id=video_id,
         content_preview=title[:200],
         metadata={"file_size": file_size, "privacy": privacy_status})

    return {"id": video_id, "title": title, "status": privacy_status}


def list_videos(part: str = "snippet,statistics", max_results: int = 10) -> list[dict]:
    with _client() as client:
        resp = client.get(
            f"{YOUTUBE_API_BASE}/videos",
            params={
                "part": part,
                "myRating": "like",
                "maxResults": min(max_results, 50),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", [])


def list_my_videos(max_results: int = 10, access_token: str = None) -> list[dict]:
    token = access_token or YOUTUBE_ACCESS_TOKEN
    with httpx.Client(headers=_headers(token), timeout=30) as client:
        resp = client.get(
            f"{YOUTUBE_API_BASE}/videos",
            params={
                "part": "snippet,statistics",
                "mine": True,
                "maxResults": min(max_results, 50),
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", [])


def search_videos(query: str, max_results: int = 10) -> list[dict]:
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{YOUTUBE_API_BASE}/search",
            params={
                "part": "snippet",
                "q": query,
                "maxResults": min(max_results, 50),
                "type": "video",
                "key": YOUTUBE_API_KEY,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", [])


def get_video(video_id: str, part: str = "snippet,statistics,content_details") -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{YOUTUBE_API_BASE}/videos",
            params={
                "part": part,
                "id": video_id,
                "key": YOUTUBE_API_KEY,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])
        return items[0] if items else {}


def delete_video(video_id: str, access_token: str = None) -> None:
    token = access_token or YOUTUBE_ACCESS_TOKEN
    with httpx.Client(headers=_headers(token), timeout=30) as client:
        resp = client.delete(f"{YOUTUBE_API_BASE}/videos", params={"id": video_id})
        resp.raise_for_status()
    _log("youtube", "delete_video", "success", platform_post_id=video_id)


def get_quota_estimate(action: str) -> int:
    quota = {
        "upload": 1600,
        "search": 100,
        "video_list": 1,
        "video_get": 1,
        "delete": 50,
    }
    return quota.get(action, 1)
