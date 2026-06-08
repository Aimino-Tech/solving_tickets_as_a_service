#!/usr/bin/env python3
"""Visual Content Platform CLI — TikTok, Instagram, YouTube, Facebook Pages.

Usage:
    python3 cli.py tiktok upload <video_path> [--title TITLE]
    python3 cli.py instagram image <image_url> [--caption CAPTION]
    python3 cli.py instagram reel <video_url> [--caption CAPTION]
    python3 cli.py youtube upload <video_path> --title TITLE [--description DESC]
    python3 cli.py youtube search <query>
    python3 cli.py facebook text <message>
    python3 cli.py facebook link <message> <url>
    python3 cli.py cross-post video <path> --title TITLE [--platforms P1,P2]
    python3 cli.py cross-post image <path> --caption CAPTION [--platforms P1,P2]
"""

import argparse
import json
import os
import sys
from pathlib import Path


def _ensure_imports():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))


def cmd_tiktok(args):
    _ensure_imports()
    from tiktok_client import (
        upload_video, check_publish_status, poll_until_complete, delete_video,
        get_auth_url, exchange_code_for_token, refresh_access_token,
    )

    if args.action == "upload":
        result = upload_video(args.video_path, title=args.title)
        print(json.dumps(result, indent=2))
    elif args.action == "publish":
        _log_and_exit("publish action removed: publishing is now part of upload (init includes post_info)")
    elif args.action == "status":
        result = check_publish_status(args.publish_id)
        print(json.dumps(result, indent=2))
    elif args.action == "delete":
        result = delete_video(args.video_id)
        print(json.dumps(result, indent=2))
    elif args.action == "auth-url":
        url = get_auth_url(args.redirect_uri)
        print(f"Auth URL: {url}")
    elif args.action == "token-exchange":
        result = exchange_code_for_token(args.code, args.redirect_uri, args.code_verifier)
        print(json.dumps(result, indent=2))
    elif args.action == "refresh":
        result = refresh_access_token(args.refresh_token)
        print(json.dumps(result, indent=2))


def cmd_instagram(args):
    _ensure_imports()
    from instagram_client import (
        create_and_publish_image, create_and_publish_reel, create_and_publish_video,
        get_media, get_user_media, create_image_container, create_video_container,
        publish_container,
    )

    if args.action == "image":
        result = create_and_publish_image(args.image_url, args.caption or "")
        print(json.dumps(result, indent=2))
    elif args.action == "reel":
        result = create_and_publish_reel(args.video_url, args.caption or "", args.thumb_url)
        print(json.dumps(result, indent=2))
    elif args.action == "video":
        result = create_and_publish_video(args.video_url, args.caption or "", args.thumb_url)
        print(json.dumps(result, indent=2))
    elif args.action == "create-container":
        if args.media_type == "IMAGE":
            result = create_image_container(args.media_url, args.caption or "")
        else:
            result = create_video_container(args.media_url, args.caption or "", args.thumb_url, is_reel=(args.media_type == "REEL"))
        print(json.dumps(result, indent=2))
    elif args.action == "publish":
        result = publish_container(args.container_id)
        print(json.dumps(result, indent=2))
    elif args.action == "get":
        result = get_media(args.media_id)
        print(json.dumps(result, indent=2))
    elif args.action == "list":
        results = get_user_media(args.limit or 25)
        print(json.dumps(results, indent=2))


def cmd_youtube(args):
    _ensure_imports()
    from youtube_client import (
        upload_video_resumable, search_videos, list_my_videos, get_video,
        delete_video, get_auth_url, exchange_code_for_token, refresh_access_token,
    )

    if args.action == "upload":
        result = upload_video_resumable(
            args.video_path, args.title, args.description or "",
            tags=args.tags.split(",") if args.tags else [],
            privacy_status=args.privacy or "public",
        )
        print(json.dumps(result, indent=2))
    elif args.action == "search":
        results = search_videos(args.query, args.max_results or 10)
        print(json.dumps(results, indent=2))
    elif args.action == "list":
        results = list_my_videos(args.max_results or 10)
        print(json.dumps(results, indent=2))
    elif args.action == "get":
        result = get_video(args.video_id)
        print(json.dumps(result, indent=2))
    elif args.action == "delete":
        delete_video(args.video_id)
        print('{"status": "deleted"}')
    elif args.action == "auth-url":
        url = get_auth_url(args.redirect_uri)
        print(f"Auth URL: {url}")
    elif args.action == "token-exchange":
        result = exchange_code_for_token(args.code, args.redirect_uri)
        print(json.dumps(result, indent=2))
    elif args.action == "refresh":
        result = refresh_access_token(args.refresh_token)
        print(json.dumps(result, indent=2))


def cmd_facebook(args):
    _ensure_imports()
    from facebook_client import (
        post_text, post_with_link, post_photo, post_video as fb_video,
        get_page_feed, get_post, delete_post, list_pages, get_page_insights,
    )

    if args.action == "text":
        result = post_text(args.message)
        print(json.dumps(result, indent=2))
    elif args.action == "link":
        result = post_with_link(args.message, args.url)
        print(json.dumps(result, indent=2))
    elif args.action == "photo":
        result = post_photo(args.image_url, args.message or "")
        print(json.dumps(result, indent=2))
    elif args.action == "video":
        result = fb_video(args.video_url, args.title or "", args.description or "")
        print(json.dumps(result, indent=2))
    elif args.action == "feed":
        results = get_page_feed(args.limit or 25)
        print(json.dumps(results, indent=2))
    elif args.action == "get":
        result = get_post(args.post_id)
        print(json.dumps(result, indent=2))
    elif args.action == "delete":
        result = delete_post(args.post_id)
        print(json.dumps(result, indent=2))
    elif args.action == "pages":
        results = list_pages()
        print(json.dumps(results, indent=2))
    elif args.action == "insights":
        result = get_page_insights(args.metric or "page_impressions,page_engagement,page_fans")
        print(json.dumps(result, indent=2))


def cmd_cross_post(args):
    _ensure_imports()
    from cross_post import cross_post_video, cross_post_image, process_queue

    if args.action == "video":
        platforms = args.platforms.split(",") if args.platforms else None
        result = cross_post_video(
            args.media_path, args.title, args.description or "", platforms, tags=args.tags.split(",") if args.tags else [],
        )
        print(json.dumps(result, indent=2))
    elif args.action == "image":
        platforms = args.platforms.split(",") if args.platforms else None
        result = cross_post_image(args.media_path, args.caption, platforms)
        print(json.dumps(result, indent=2))
    elif args.action == "process-queue":
        results = process_queue()
        print(json.dumps(results, indent=2))


def _log_and_exit(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Visual Content Platform CLI")
    sub = parser.add_subparsers(dest="platform", required=True)

    p_tiktok = sub.add_parser("tiktok", help="TikTok operations")
    tiktok_sub = p_tiktok.add_subparsers(dest="action", required=True)

    p_tt_upload = tiktok_sub.add_parser("upload", help="Upload and publish video")
    p_tt_upload.add_argument("video_path", help="Path to video file")
    p_tt_upload.add_argument("--title", help="Video title (defaults to filename)")

    p_tt_pub = tiktok_sub.add_parser("publish", help="Publish video with title")
    p_tt_pub.add_argument("--title", default="MCP Open Source Tool", help="Video title")

    p_tt_status = tiktok_sub.add_parser("status", help="Check publish status")
    p_tt_status.add_argument("publish_id", help="Publish ID from upload")

    p_tt_del = tiktok_sub.add_parser("delete", help="Delete video")
    p_tt_del.add_argument("video_id", help="Video ID to delete")

    p_tt_auth = tiktok_sub.add_parser("auth-url", help="Get OAuth PKCE authorization URL")
    p_tt_auth.add_argument("--redirect-uri", default="http://localhost:8080/callback", help="OAuth redirect URI")

    p_tt_token = tiktok_sub.add_parser("token-exchange", help="Exchange auth code for token")
    p_tt_token.add_argument("code", help="Authorization code from callback")
    p_tt_token.add_argument("--redirect-uri", default="http://localhost:8080/callback")
    p_tt_token.add_argument("--code-verifier", required=True, help="PKCE code verifier")

    p_tt_refresh = tiktok_sub.add_parser("refresh", help="Refresh access token")
    p_tt_refresh.add_argument("--refresh-token", help="Refresh token (defaults to env)")

    p_ig = sub.add_parser("instagram", help="Instagram operations")
    ig_sub = p_ig.add_subparsers(dest="action", required=True)

    p_ig_img = ig_sub.add_parser("image", help="Post an image")
    p_ig_img.add_argument("image_url", help="URL of the image to post")
    p_ig_img.add_argument("--caption", help="Image caption")

    p_ig_reel = ig_sub.add_parser("reel", help="Post a reel")
    p_ig_reel.add_argument("video_url", help="URL of the video")
    p_ig_reel.add_argument("--caption", help="Reel caption")
    p_ig_reel.add_argument("--thumb-url", help="Custom thumbnail URL")

    p_ig_vid = ig_sub.add_parser("video", help="Post a video (feed)")
    p_ig_vid.add_argument("video_url", help="URL of the video")
    p_ig_vid.add_argument("--caption", help="Video caption")
    p_ig_vid.add_argument("--thumb-url", help="Custom thumbnail URL")

    p_ig_cc = ig_sub.add_parser("create-container", help="Create a media container")
    p_ig_cc.add_argument("media_type", choices=["IMAGE", "VIDEO", "REEL"], help="Media type")
    p_ig_cc.add_argument("media_url", help="URL of the media")
    p_ig_cc.add_argument("--caption", help="Caption")
    p_ig_cc.add_argument("--thumb-url", help="Thumbnail URL")

    p_ig_pub = ig_sub.add_parser("publish", help="Publish a container")
    p_ig_pub.add_argument("container_id", help="Container ID")

    p_ig_get = ig_sub.add_parser("get", help="Get media details")
    p_ig_get.add_argument("media_id", help="Media ID")

    p_ig_list = ig_sub.add_parser("list", help="List recent media")
    p_ig_list.add_argument("--limit", type=int, default=25, help="Max results")

    p_yt = sub.add_parser("youtube", help="YouTube operations")
    yt_sub = p_yt.add_subparsers(dest="action", required=True)

    p_yt_up = yt_sub.add_parser("upload", help="Upload video with resumable upload")
    p_yt_up.add_argument("video_path", help="Path to video file")
    p_yt_up.add_argument("--title", required=True, help="Video title")
    p_yt_up.add_argument("--description", help="Video description")
    p_yt_up.add_argument("--tags", help="Comma-separated tags")
    p_yt_up.add_argument("--privacy", choices=["public", "private", "unlisted"], default="public")

    p_yt_search = yt_sub.add_parser("search", help="Search videos")
    p_yt_search.add_argument("query", help="Search query")
    p_yt_search.add_argument("--max-results", type=int, default=10)

    p_yt_list = yt_sub.add_parser("list", help="List my videos")
    p_yt_list.add_argument("--max-results", type=int, default=10)

    p_yt_get = yt_sub.add_parser("get", help="Get video details")
    p_yt_get.add_argument("video_id", help="Video ID")

    p_yt_del = yt_sub.add_parser("delete", help="Delete video")
    p_yt_del.add_argument("video_id", help="Video ID")

    p_yt_auth = yt_sub.add_parser("auth-url", help="Get OAuth authorization URL")
    p_yt_auth.add_argument("--redirect-uri", default="http://localhost:8080/callback")

    p_yt_token = yt_sub.add_parser("token-exchange", help="Exchange auth code for token")
    p_yt_token.add_argument("code", help="Authorization code")
    p_yt_token.add_argument("--redirect-uri", default="http://localhost:8080/callback")

    p_yt_refresh = yt_sub.add_parser("refresh", help="Refresh access token")
    p_yt_refresh.add_argument("--refresh-token", help="Refresh token (defaults to env)")

    p_fb = sub.add_parser("facebook", help="Facebook Pages operations")
    fb_sub = p_fb.add_subparsers(dest="action", required=True)

    p_fb_txt = fb_sub.add_parser("text", help="Post text message")
    p_fb_txt.add_argument("message", help="Post message")

    p_fb_link = fb_sub.add_parser("link", help="Post with link")
    p_fb_link.add_argument("message", help="Post message")
    p_fb_link.add_argument("url", help="Link URL")

    p_fb_photo = fb_sub.add_parser("photo", help="Post photo")
    p_fb_photo.add_argument("image_url", help="Image URL")
    p_fb_photo.add_argument("--message", help="Photo caption")

    p_fb_vid = fb_sub.add_parser("video", help="Post video")
    p_fb_vid.add_argument("video_url", help="Video URL")
    p_fb_vid.add_argument("--title", help="Video title")
    p_fb_vid.add_argument("--description", help="Video description")

    p_fb_feed = fb_sub.add_parser("feed", help="Get page feed")
    p_fb_feed.add_argument("--limit", type=int, default=25)

    p_fb_get = fb_sub.add_parser("get", help="Get post details")
    p_fb_get.add_argument("post_id", help="Post ID")

    p_fb_del = fb_sub.add_parser("delete", help="Delete post")
    p_fb_del.add_argument("post_id", help="Post ID to delete")

    p_fb_pages = fb_sub.add_parser("pages", help="List managed pages")

    p_fb_insights = fb_sub.add_parser("insights", help="Get page insights")
    p_fb_insights.add_argument("--metric", default="page_impressions,page_engagement,page_fans")

    p_xp = sub.add_parser("cross-post", help="Cross-platform posting")
    xp_sub = p_xp.add_subparsers(dest="action", required=True)

    p_xp_vid = xp_sub.add_parser("video", help="Cross-post video to multiple platforms")
    p_xp_vid.add_argument("media_path", help="Path to video file")
    p_xp_vid.add_argument("--title", required=True, help="Content title")
    p_xp_vid.add_argument("--description", help="Content description")
    p_xp_vid.add_argument("--platforms", help="Comma-separated: tiktok,instagram_reel,youtube_short,facebook")
    p_xp_vid.add_argument("--tags", help="Comma-separated tags")

    p_xp_img = xp_sub.add_parser("image", help="Cross-post image to multiple platforms")
    p_xp_img.add_argument("media_path", help="Path to image file")
    p_xp_img.add_argument("--caption", required=True, help="Image caption")
    p_xp_img.add_argument("--platforms", help="Comma-separated: instagram_feed,facebook")

    p_xp_q = xp_sub.add_parser("process-queue", help="Process pending cross-post queue")

    args = parser.parse_args()
    if args.platform == "tiktok":
        cmd_tiktok(args)
    elif args.platform == "instagram":
        cmd_instagram(args)
    elif args.platform == "youtube":
        cmd_youtube(args)
    elif args.platform == "facebook":
        cmd_facebook(args)
    elif args.platform == "cross-post":
        cmd_cross_post(args)


if __name__ == "__main__":
    main()
