"""TikTok Content Posting API v2 client.

Supports PKCE OAuth flow, chunked video upload, and post publishing.
API: https://developers.tiktok.com/documentation/content-posting/
"""

import base64
import hashlib
import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx

TIKTOK_API_BASE = "https://open.tiktokapis.com/v2"
TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
TIKTOK_ACCESS_TOKEN = os.getenv("TIKTOK_ACCESS_TOKEN", "")
TIKTOK_REFRESH_TOKEN = os.getenv("TIKTOK_REFRESH_TOKEN", "")

CHUNK_SIZE = 4 * 1024 * 1024
MAX_RETRIES = 3
RETRY_DELAY = 2


def _headers(access_token: str = None) -> dict:
    token = access_token or TIKTOK_ACCESS_TOKEN
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _client(access_token: str = None) -> httpx.Client:
    return httpx.Client(headers=_headers(access_token), timeout=120)


def _log(platform: str, action: str, status: str, **kwargs):
    try:
        from engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, **kwargs)
    except Exception:
        pass


def generate_pkce_challenge() -> tuple[str, str]:
    code_verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return code_verifier, code_challenge


def get_auth_url(redirect_uri: str, state: str = None) -> str:
    from urllib.parse import urlencode
    _, code_challenge = generate_pkce_challenge()
    params = {
        "client_key": TIKTOK_CLIENT_KEY,
        "scope": "video.publish,video.upload",
        "redirect_uri": redirect_uri,
        "state": state or str(uuid.uuid4()),
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"https://www.tiktok.com/v2/auth/authorize/?{urlencode(params)}"


def exchange_code_for_token(auth_code: str, redirect_uri: str, code_verifier: str) -> dict:
    resp = httpx.post(
        f"{TIKTOK_API_BASE}/oauth/token/",
        data={
            "client_key": TIKTOK_CLIENT_KEY,
            "client_secret": TIKTOK_CLIENT_SECRET,
            "code": auth_code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(refresh_token: str) -> dict:
    resp = httpx.post(
        f"{TIKTOK_API_BASE}/oauth/token/",
        data={
            "client_key": TIKTOK_CLIENT_KEY,
            "client_secret": TIKTOK_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def initiate_upload(
    title: str,
    file_size: int,
    total_chunks: int,
    privacy_level: str = "PUBLIC_TO_EVERYONE",
    disable_duet: bool = False,
    disable_stitch: bool = False,
    disable_comment: bool = False,
    brand_organic_opt_in: bool = True,
    brand_content_opt_in: bool = False,
    access_token: str = None,
) -> dict:
    token = access_token or TIKTOK_ACCESS_TOKEN
    body = {
        "source_info": {
            "source": "FILE",
            "video_size": file_size,
            "chunk_size": CHUNK_SIZE,
            "total_chunk_count": total_chunks,
        },
        "post_info": {
            "title": title,
            "privacy_level": privacy_level,
            "disable_duet": disable_duet,
            "disable_stitch": disable_stitch,
            "disable_comment": disable_comment,
            "brand_organic_opt_in": brand_organic_opt_in,
            "brand_content_opt_in": brand_content_opt_in,
        },
    }
    with _client(token) as client:
        resp = client.post(
            f"{TIKTOK_API_BASE}/post/publish/video/init/",
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
        _log("tiktok", "initiate_upload", "success",
             metadata={
                 "upload_url": data.get("data", {}).get("upload_url"),
                 "publish_id": data.get("data", {}).get("publish_id"),
             })
        return data


def upload_chunk(upload_url: str, chunk: bytes, chunk_index: int, file_size: int, access_token: str = None) -> None:
    token = access_token or TIKTOK_ACCESS_TOKEN
    start_byte = chunk_index * CHUNK_SIZE
    end_byte = start_byte + len(chunk) - 1
    content_range = f"bytes {start_byte}-{end_byte}/{file_size}"

    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.put(
                upload_url,
                content=chunk,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Range": content_range,
                    "Authorization": f"Bearer {token}",
                },
                timeout=300,
            )
            if resp.status_code in (200, 201, 308):
                return
            resp.raise_for_status()
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            raise


def upload_video(
    file_path: str,
    title: str = None,
    privacy_level: str = "PUBLIC_TO_EVERYONE",
    access_token: str = None,
) -> dict:
    file_path = str(Path(file_path).resolve())
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    file_size = os.path.getsize(file_path)
    total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    video_title = title or os.path.splitext(os.path.basename(file_path))[0]

    init_data = initiate_upload(
        title=video_title,
        file_size=file_size,
        total_chunks=total_chunks,
        privacy_level=privacy_level,
        access_token=access_token,
    )
    upload_url = init_data.get("data", {}).get("upload_url")
    publish_id = init_data.get("data", {}).get("publish_id")
    if not upload_url or not publish_id:
        raise RuntimeError(f"No upload URL or publish ID returned: {init_data}")

    with open(file_path, "rb") as f:
        for i in range(total_chunks):
            chunk = f.read(CHUNK_SIZE)
            upload_chunk(upload_url, chunk, i, file_size, access_token)

    result = poll_until_complete(publish_id, access_token)

    _log("tiktok", "upload_video", "success",
         media_type="video", media_url=file_path,
         platform_post_id=result.get("data", {}).get("publish_id"),
         metadata={"file_size": file_size, "total_chunks": total_chunks})

    return result


def check_publish_status(publish_id: str, access_token: str = None) -> dict:
    token = access_token or TIKTOK_ACCESS_TOKEN
    with _client(token) as client:
        resp = client.post(
            f"{TIKTOK_API_BASE}/post/publish/status/fetch/",
            json={"publish_id": publish_id},
        )
        resp.raise_for_status()
        return resp.json()


def poll_until_complete(
    publish_id: str,
    access_token: str = None,
    poll_interval: int = 2,
    poll_timeout: int = 300,
) -> dict:
    elapsed = 0
    while elapsed < poll_timeout:
        data = check_publish_status(publish_id, access_token)
        status = data.get("data", {}).get("status", "")
        if status == "PUBLISH_COMPLETE":
            return data
        if status == "FAILED":
            raise RuntimeError(f"Publish failed: {data}")
        time.sleep(poll_interval)
        elapsed += poll_interval
    raise TimeoutError(f"Publish {publish_id} not completed after {poll_timeout}s")


def delete_video(video_id: str, access_token: str = None) -> dict:
    token = access_token or TIKTOK_ACCESS_TOKEN
    with _client(token) as client:
        resp = client.post(
            f"{TIKTOK_API_BASE}/video/{video_id}/delete/",
        )
        resp.raise_for_status()
        data = resp.json()
        _log("tiktok", "delete_video", "success", platform_post_id=video_id)
        return data
