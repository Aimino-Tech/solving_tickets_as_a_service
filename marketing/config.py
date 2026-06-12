"""Marketing campaign configuration models.

Schema matching existing ``marketing/campaigns/`` JSON patterns.
Uses stdlib ``dataclasses`` — no external dependencies.
"""

from __future__ import annotations

import dataclasses
from typing import Any


@dataclasses.dataclass
class WaveConfig:
    """A single wave within a campaign — targets one platform for one round."""

    wave_number: int = 0
    platform: str = ""
    subreddits_or_targets: list[str] | None = None
    content_angles: list[str] = dataclasses.field(default_factory=list)
    comment_count: int = 1
    min_gap_hours: float = 4.0
    schedule_notes: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> WaveConfig:
        return cls(
            wave_number=d.get("wave_number", 0),
            platform=d.get("platform", ""),
            subreddits_or_targets=d.get("subreddits_or_targets"),
            content_angles=d.get("content_angles", []),
            comment_count=d.get("comment_count", 1),
            min_gap_hours=d.get("min_gap_hours", 4.0),
            schedule_notes=d.get("schedule_notes"),
        )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "wave_number": self.wave_number,
            "platform": self.platform,
            "content_angles": self.content_angles,
            "comment_count": self.comment_count,
            "min_gap_hours": self.min_gap_hours,
        }
        if self.subreddits_or_targets is not None:
            d["subreddits_or_targets"] = self.subreddits_or_targets
        if self.schedule_notes is not None:
            d["schedule_notes"] = self.schedule_notes
        return d


@dataclasses.dataclass
class ScheduleConfig:
    """Overall campaign schedule configuration."""

    start_date: str = ""
    end_date: str | None = None
    daily_target: int = 3
    working_hours_start: int = 9
    working_hours_end: int = 18

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ScheduleConfig:
        return cls(
            start_date=d.get("start_date", ""),
            end_date=d.get("end_date"),
            daily_target=d.get("daily_target", 3),
            working_hours_start=d.get("working_hours_start", 9),
            working_hours_end=d.get("working_hours_end", 18),
        )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "start_date": self.start_date,
            "daily_target": self.daily_target,
            "working_hours_start": self.working_hours_start,
            "working_hours_end": self.working_hours_end,
        }
        if self.end_date is not None:
            d["end_date"] = self.end_date
        return d


@dataclasses.dataclass
class CampaignConfig:
    """Full campaign configuration.

    Fields mirror the structure seen in ``campaign-items.json`` and related
    campaign-planning documents under ``marketing/campaigns/``.
    """

    name: str = ""
    product: str = ""
    github_repo: str = ""
    npm_package: str = ""
    platforms: list[str] = dataclasses.field(default_factory=list)
    waves: list[WaveConfig] = dataclasses.field(default_factory=list)
    schedule: ScheduleConfig = dataclasses.field(default_factory=ScheduleConfig)
    accounts: list[str] = dataclasses.field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CampaignConfig:
        waves_raw: list[dict[str, Any]] = d.get("waves", [])
        waves = [WaveConfig.from_dict(w) for w in waves_raw]

        schedule_raw: dict[str, Any] = d.get("schedule", {})
        schedule = ScheduleConfig.from_dict(schedule_raw)

        return cls(
            name=d.get("name", ""),
            product=d.get("product", ""),
            github_repo=d.get("github_repo", ""),
            npm_package=d.get("npm_package", ""),
            platforms=d.get("platforms", []),
            waves=waves,
            schedule=schedule,
            accounts=d.get("accounts", []),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "product": self.product,
            "github_repo": self.github_repo,
            "npm_package": self.npm_package,
            "platforms": self.platforms,
            "waves": [w.to_dict() for w in self.waves],
            "schedule": self.schedule.to_dict(),
            "accounts": self.accounts,
        }


# ── free‑standing helpers ──────────────────────────────────────────────────


def campaign_config_from_dict(d: dict[str, Any]) -> CampaignConfig:
    """Parse a JSON-style dict into a ``CampaignConfig``."""
    return CampaignConfig.from_dict(d)


def campaign_config_to_dict(config: CampaignConfig) -> dict[str, Any]:
    """Serialize a ``CampaignConfig`` back to a JSON-safe dict."""
    return config.to_dict()
