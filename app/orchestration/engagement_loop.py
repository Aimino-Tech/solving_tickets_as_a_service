from __future__ import annotations
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.common.config import settings
from orchestrator_state import get_repository as get_orch_repo, OrchestratorRepository
from analyze import analyze_items, prioritize_results
from generate_reply import generate_reply, generate_digest
from backoff import BackoffTracker, wait_with_backoff
from app.tracking import tracker

PHASES = ["POLL", "ANALYZE", "DECIDE", "ENGAGE_LOG"]


class PhaseResult:
    def __init__(self, phase: str, success: bool, data: Any = None, error: str = None):
        self.phase = phase
        self.success = success
        self.data = data
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "success": self.success,
            "data": self.data,
            "error": self.error,
        }


class OrchestratorEngine:
    def __init__(self, orch_repo: OrchestratorRepository = None,
                 backoff: BackoffTracker = None):
        self.orch = orch_repo or get_orch_repo()
        self.backoff = backoff or BackoffTracker()
        self.dry_run = False

    def poll_platforms(self) -> list[dict[str, Any]]:
        results = []
        platform_adapters = self._discover_adapters()
        for adapter_name, adapter_fn in platform_adapters.items():
            try:
                mentions = adapter_fn()
                results.extend(mentions)
            except Exception as e:
                print(f"Poll failed for {adapter_name}: {e}", file=sys.stderr)
                self.backoff.record_failure(adapter_name)
        return results

    def _discover_adapters(self) -> dict[str, callable]:
        adapters = {}
        adapters["indian_engagement"] = self._poll_indian_engagement
        adapters["campaign_metrics"] = self._poll_campaign_metrics
        return adapters

    def _poll_indian_engagement(self) -> list[dict[str, Any]]:
        eng_db = Path("./workspace/indian-engagement/engagements.duckdb")
        if not eng_db.exists():
            return []
        try:
            import duckdb
            con = duckdb.connect(str(eng_db))
            rows = con.execute(
                "SELECT platform, action, metadata, created_at FROM engagements ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
            con.close()
            results = []
            for row in rows:
                meta = json.loads(row[2]) if row[2] else {}
                results.append({
                    "id": f"ie_{row[0]}_{int(time.time())}",
                    "platform": row[0],
                    "content_snippet": meta.get("title", meta.get("text", "")),
                    "source_url": meta.get("url", meta.get("chat_id")),
                    "created_at": str(row[3]),
                })
            return results
        except Exception:
            return []

    def _poll_campaign_metrics(self) -> list[dict[str, Any]]:
        try:
            from campaign_manager import CampaignManager
            mgr = CampaignManager()
            metrics = mgr.collect_metrics()
            stars = metrics.get("github_stars")
            downloads = metrics.get("npm_weekly_downloads")
            self.orch.log_campaign_metrics(
                "fast-html-mcp-launch",
                github_stars=stars,
                npm_downloads=downloads,
                raw_data=metrics,
            )
            return [{
                "id": f"campaign_metrics_{int(time.time())}",
                "platform": "github",
                "content_snippet": f"Stars: {stars}, npm downloads: {downloads}",
                "source_url": "https://github.com/Aimino-Tech/fast-html-mcp",
                "created_at": metrics.get("timestamp", ""),
            }]
        except Exception as e:
            print(f"Campaign metrics poll failed: {e}", file=sys.stderr)
            return []

    def analyze(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results = analyze_items(items)
        prioritized = prioritize_results(results)
        output = []
        for r in prioritized:
            d = r.to_dict()
            lid = self.orch.add_lead(
                platform=items[0].get("platform", "unknown") if items else "unknown",
                source_url=items[0].get("source_url") if items else None,
                relevance_score=r.relevance,
                sentiment=r.sentiment,
                opportunity_score=r.opportunity,
                urgency=r.urgency,
            )
            d["lead_id"] = lid
            output.append(d)
        return output

    def decide(self, analyzed: list[dict[str, Any]]) -> list[dict[str, Any]]:
        decisions = []
        for item in analyzed:
            decision = self._decide_single(item)
            if decision["action"] == "skip":
                continue
            decisions.append(decision)
        return decisions

    def _decide_single(self, item: dict[str, Any]) -> dict[str, Any]:
        relevance = item.get("relevance", 0)
        sentiment = item.get("sentiment", "neutral")
        urgency = item.get("urgency", "batch")

        if relevance >= 80 and sentiment != "negative" and urgency in ("immediate", "today"):
            return {"id": item.get("id"), "action": "auto_approve", "reason": "high_relevance_positive"}
        if relevance < 30 or sentiment == "negative":
            return {"id": item.get("id"), "action": "skip", "reason": "low_relevance_or_negative"}
        if relevance >= 60 and settings.auto_approve:
            return {"id": item.get("id"), "action": "auto_approve", "reason": "moderate_relevance_auto"}
        return {
            "id": item.get("id"), "action": "human_review",
            "reason": f"relevance={relevance}, sentiment={sentiment}, needs_operator",
            "item": item,
        }

    def engage(self, decisions: list[dict[str, Any]], post_map: dict[str, Any] = None) -> list[PhaseResult]:
        results = []
        for decision in decisions:
            if decision["action"] != "auto_approve":
                continue
            try:
                item = decision.get("item", {})
                draft = generate_reply(
                    post_content=item.get("content_snippet", ""),
                    platform=item.get("platform", "reddit"),
                    sentiment=item.get("sentiment"),
                    relevance=item.get("relevance"),
                )
                if not self.dry_run:
                    eid = self.orch.log_engagement(
                        platform=item.get("platform", "unknown"),
                        action="reply",
                        target_url=item.get("source_url"),
                        content_preview=draft.content[:200],
                        score=item.get("relevance", 0),
                        status="auto_approved",
                    )
                    self.orch.update_engagement(eid, status="auto_approved",
                                                approved_by="orchestrator")
                results.append(PhaseResult("ENGAGE_LOG", True, {
                    "decision": decision,
                    "draft": draft.to_dict(),
                }))
            except Exception as e:
                results.append(PhaseResult("ENGAGE_LOG", False, error=str(e)))
        if not results:
            results.append(PhaseResult("ENGAGE_LOG", True, {
                "engaged": 0, "reason": "no_auto_approve_decisions"
            }))
        return results

    def log_results(self, phase_results: list[PhaseResult]) -> None:
        self.orch.set_state("last_loop_result", {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "phases": [r.to_dict() for r in phase_results],
        })
        self.orch.set_state("last_loop_time", datetime.now(timezone.utc).isoformat())

    def run_cycle(self, dry_run: bool = False) -> dict[str, Any]:
        self.dry_run = dry_run
        start = time.time()
        results = []

        poll_data = self.poll_platforms()
        results.append(PhaseResult("POLL", True, {"count": len(poll_data)}))
        if not poll_data:
            results.append(PhaseResult("ANALYZE", True, {"count": 0}))
            results.append(PhaseResult("DECIDE", True, {"count": 0}))
            results.append(PhaseResult("ENGAGE_LOG", True, {"count": 0}))
            self.log_results(results)
            return {
                "cycle_time_seconds": time.time() - start,
                "phases": [r.to_dict() for r in results],
            }

        analyzed = self.analyze(poll_data)
        results.append(PhaseResult("ANALYZE", True, {"analyzed": len(analyzed)}))

        decisions = self.decide(analyzed)
        results.append(PhaseResult("DECIDE", True, {
            "total": len(decisions),
            "auto_approve": sum(1 for d in decisions if d["action"] == "auto_approve"),
            "human_review": sum(1 for d in decisions if d["action"] == "human_review"),
            "skipped": sum(1 for d in decisions if d["action"] == "skip"),
        }))

        post_map = {item.get("id"): item for item in poll_data}
        engage_results = self.engage(decisions, post_map)
        if engage_results:
            results.extend(engage_results)
        else:
            results.append(PhaseResult("ENGAGE_LOG", True, {"count": 0}))

        self.log_results(results)
        cycle_result = {
            "cycle_time_seconds": time.time() - start,
            "phases": [r.to_dict() for r in results],
        }
        tracker.track_orchestration_cycle([r.to_dict() for r in results])
        return cycle_result


def run_scan_cycle(dry_run: bool = False) -> dict[str, Any]:
    engine = OrchestratorEngine()
    return engine.run_cycle(dry_run=dry_run)


def run_daily_report() -> dict[str, Any]:
    repo = get_orch_repo()
    summary = repo.summary(days=1)
    return {
        "type": "daily_report",
        "summary": summary,
    }


def run_weekly_digest() -> str:
    repo = get_orch_repo()
    summary = repo.summary(days=7)
    pending = repo.get_pending_engagements(limit=5)
    content = generate_digest(
        [{"platform": s["platform"], "status": s["status"]} for s in summary.get("engagement_counts", [])]
    )
    return content


def run_followup_check() -> dict[str, Any]:
    repo = get_orch_repo()
    pending = repo.get_pending_engagements(limit=20)
    return {
        "type": "followup_check",
        "pending_count": len(pending),
        "pending": [dict(r) for r in pending],
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Marketing orchestration engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("scan", help="Run a single orchestration cycle")
    sub.add_parser("daily", help="Generate daily report")
    sub.add_parser("weekly", help="Generate weekly digest")
    sub.add_parser("followup", help="Check pending follow-ups")

    p_scan_dry = sub.add_parser("scan-dry", help="Run dry-run orchestration cycle")

    args = parser.parse_args()

    if args.command == "scan":
        result = run_scan_cycle()
        print(json.dumps(result, indent=2, default=str))
    elif args.command == "scan-dry":
        result = run_scan_cycle(dry_run=True)
        print(json.dumps(result, indent=2, default=str))
    elif args.command == "daily":
        result = run_daily_report()
        print(json.dumps(result, indent=2, default=str))
    elif args.command == "weekly":
        digest = run_weekly_digest()
        print(json.dumps({"digest": digest}, indent=2))
    elif args.command == "followup":
        result = run_followup_check()
        print(json.dumps(result, indent=2, default=str))
