# SYNTARO — Marketplace Visual Assets

> Place all final PNG/SVG assets for the GitHub Marketplace listing in this directory.

## Required Assets

| Asset | Format | Dimensions | Max Size | Status |
|-------|--------|------------|----------|--------|
| Logo | PNG | 120×120 px | 1 MB | Placeholder SVG present (`logo.svg`) |
| Listing Screenshot (Option 1) | PNG | 1280×640 px | 2 MB | Placeholder SVGs present |
| Listing Screenshot (Option 2) | PNG | 1280×640 px | 2 MB | Placeholder SVGs present |
| Listing Screenshot (Option 3) | PNG | 1280×640 px | 2 MB | Placeholder SVGs present |
| Demo GIF (optional) | GIF/MP4 | 1280×720 or 1920×1080 | 10 MB | Not yet created |

## Naming Convention

When adding final assets, follow this naming:

```
logo-120x120.png                    — App logo
screenshot-plan-output.png          — Plan output screenshot (Option 1)
screenshot-dashboard.png            — Dashboard view screenshot (Option 2)
screenshot-split-view.png           — Split issue+PR view (Option 3)
demo-walkthrough.mp4                — Demo walkthrough video
```

## Design Reference

- Brand colors: See `docs/brand-guide.md` or `public/github-app-manifest.json`
- Font: Playfair Display (headings) / DM Sans (body) — consistent with website
- Logo should be high-contrast on both light and dark backgrounds
- Screenshots must use a demo repo (e.g. `syntaro-demo`) with no sensitive data
- Minimum readable text size: 14 px

## Tools

- [Kap](https://getkap.co/) (macOS, free) — screen recording
- [Screen Studio](https://www.screen.studio/) (macOS, paid) — professional recording
- [OBS Studio](https://obsproject.com/) (cross-platform, free) — advanced recording
- [CleanShot X](https://cleanshot.com/) (macOS, paid) — screenshots + recording
