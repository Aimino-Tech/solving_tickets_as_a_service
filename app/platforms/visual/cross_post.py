"""Cross-platform visual content orchestrator.

Publishes the same media to multiple visual platforms from a single upload call.
Handles platform-specific optimizations (9:16 for TikTok/Reels, 16:9 for YouTube).
"""

import json
import os
import time
from pathlib import Path

import httpx

from engagement_logger import queue_content, get_pending_queue, mark_queue_done
from tiktok_client import upload_video as tiktok_upload
from instagram_client import create_and_publish_image, create_and_publish_reel, create_and_publish_video
from youtube_client import upload_video_resumable as youtube_upload
from facebook_client import post_text, post_photo, post_video as facebook_video


def _log(platform: str, action: str, status: str, **kwargs):
    try:
        from engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, **kwargs)
    except ImportError:
        pass


PLATFORM_ASPECT_RATIOS = {
    "tiktok": "9:16",
    "instagram_reel": "9:16",
    "instagram_feed": "1:1",
    "youtube": "16:9",
    "youtube_short": "9:16",
    "facebook": "1.91:1",
}


def cross_post_video(
    file_path: str,
    title: str,
    description: str = "",
    platforms: list[str] = None,
    tags: list[str] = None,
) -> dict:
    if platforms is None:
        platforms = ["tiktok", "instagram_reel", "youtube_short", "facebook"]

    results = {}
    queue_id = queue_content(
        title=title,
        media_path=file_path,
        media_type="video",
        target_platforms=platforms,
        description=description,
        metadata={"tags": tags or []},
    )

    for platform in platforms:
        try:
            if platform == "tiktok":
                result = tiktok_upload(file_path)
                results[platform] = {"status": "success", "data": result}

            elif platform == "instagram_reel":
                video_url = _require_http_url(file_path)
                result = create_and_publish_reel(video_url, title)
                results[platform] = {"status": "success", "data": result}

            elif platform == "instagram_feed":
                video_url = _require_http_url(file_path)
                result = create_and_publish_video(video_url, title)
                results[platform] = {"status": "success", "data": result}

            elif platform in ("youtube", "youtube_short"):
                privacy = "public"
                result = youtube_upload(
                    file_path=file_path,
                    title=title,
                    description=description,
                    tags=tags,
                    privacy_status=privacy,
                )
                results[platform] = {"status": "success", "data": result}

            elif platform == "facebook":
                result = facebook_video(
                    video_url=_require_http_url(file_path),
                    title=title,
                    description=description,
                )
                results[platform] = {"status": "success", "data": result}

            else:
                results[platform] = {"status": "skipped", "error": f"Unknown platform: {platform}"}

        except Exception as e:
            results[platform] = {"status": "failed", "error": str(e)}
            _log(platform, "cross_post", "failed", error_message=str(e))

    cross_post_id = _generate_cross_post_id(results)
    mark_queue_done(queue_id, cross_post_id)

    _log("cross_platform", "cross_post_video", "success",
         metadata={"platforms": platforms, "results": {k: v["status"] for k, v in results.items()}})

    return {"cross_post_id": cross_post_id, "results": results}


def cross_post_image(
    image_path: str,
    caption: str,
    platforms: list[str] = None,
) -> dict:
    if platforms is None:
        platforms = ["instagram_feed", "facebook"]

    results = {}
    queue_id = queue_content(
        title=caption[:100],
        media_path=image_path,
        media_type="image",
        target_platforms=platforms,
        description=caption,
    )

    for platform in platforms:
        try:
            if platform == "instagram_feed":
                image_url = _require_http_url(image_path)
                result = create_and_publish_image(image_url, caption)
                results[platform] = {"status": "success", "data": result}

            elif platform == "facebook":
                result = post_photo(image_url=_require_http_url(image_path), message=caption)
                results[platform] = {"status": "success", "data": result}

            else:
                results[platform] = {"status": "skipped", "error": f"Unknown platform: {platform}"}

        except Exception as e:
            results[platform] = {"status": "failed", "error": str(e)}
            _log(platform, "cross_post_image", "failed", error_message=str(e))

    cross_post_id = _generate_cross_post_id(results)
    mark_queue_done(queue_id, cross_post_id)

    _log("cross_platform", "cross_post_image", "success",
         metadata={"platforms": platforms, "results": {k: v["status"] for k, v in results.items()}})

    return {"cross_post_id": cross_post_id, "results": results}


def process_queue() -> list[dict]:
    queue = get_pending_queue()
    results = []
    for item in queue:
        try:
            platforms = json.loads(item["target_platforms"])
            media_type = item["media_type"]
            title = item["title"]
            file_path = item["media_path"]
            description = item.get("description", "")

            if media_type == "video":
                result = cross_post_video(file_path, title, description, platforms)
            elif media_type == "image":
                result = cross_post_image(file_path, title, platforms)
            else:
                result = {"error": f"Unsupported media type: {media_type}"}

            results.append({"queue_id": item["id"], "result": result})
        except Exception as e:
            results.append({"queue_id": item["id"], "error": str(e)})

    return results


def _generate_cross_post_id(results: dict) -> str:
    import hashlib
    raw = json.dumps(results, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _require_http_url(file_path: str) -> str:
    file_path = str(file_path)
    base = os.getenv("VISUAL_CONTENT_STORAGE_URL", "")
    if not base or base.startswith("file://"):
        raise RuntimeError(
            "VISUAL_CONTENT_STORAGE_URL must be set to an HTTPS URL for Instagram/Facebook uploads. "
            "Upload your media to a temporary storage service first."
        )
    return f"{base.rstrip('/')}/{os.path.basename(file_path)}"
