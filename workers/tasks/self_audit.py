import logging

from celery import shared_task

from workers.quality.models import AntiMockupFinding, SelfAuditChecklistItem, SelfAuditResult

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.self_audit.run_self_audit",
    autoretry_for=(Exception,),
)
def run_self_audit(self, issue_context: dict, verification_result: dict, workspace_path: str = "") -> dict:
    logger.info(
        "Running self-audit \u2014 issue=%s",
        issue_context.get("issue_id", issue_context.get("issue_url", "unknown")),
    )
    try:
        checklist_items: list[SelfAuditChecklistItem] = []
        ac_list = issue_context.get("acceptance_criteria", [])

        if ac_list:
            for ac in ac_list:
                checklist_items.append(
                    SelfAuditChecklistItem(
                        ac=ac,
                        met=False,
                        evidence="Pending fresh-context re-verification (AIM-1957)",
                    )
                )
        else:
            checklist_items.append(
                SelfAuditChecklistItem(
                    ac="All acceptance criteria met",
                    met=verification_result.get("passed", False),
                    evidence=f"Verification result: passed={verification_result.get('passed', False)}",
                )
            )

        anti_mockup_findings: list[AntiMockupFinding] = []
        for finding in verification_result.get("anti_mockup_findings", []):
            anti_mockup_findings.append(
                AntiMockupFinding(
                    file=finding.get("file", "unknown"),
                    line=finding.get("line", 0),
                    pattern=finding.get("pattern", "unknown"),
                    severity=finding.get("severity", "warning"),
                    snippet=finding.get("snippet", ""),
                )
            )

        missing_items: list[str] = []
        for item in checklist_items:
            if not item.met:
                missing_items.append(item.ac)

        passed = len(missing_items) == 0 and len(anti_mockup_findings) == 0

        result = SelfAuditResult(
            checklist=checklist_items,
            missing_items=missing_items,
            anti_mockup_findings=anti_mockup_findings,
            passed=passed,
        )

        logger.info(
            "Self-audit complete \u2014 passed=%s ac_total=%d missing=%d mockup_findings=%d",
            result.passed,
            len(result.checklist),
            len(result.missing_items),
            len(result.anti_mockup_findings),
        )

        return result.model_dump()
    except Exception as exc:
        logger.error("Self-audit failed \u2014 %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.self_audit.orchestrate_pipeline",
    autoretry_for=(Exception,),
)
def orchestrate_pipeline(self, issue_data: dict) -> dict:
    logger.info("Orchestrating pipeline \u2014 issue=%s", issue_data.get("issue_id", "unknown"))
    try:
        steps: list[str] = []
        results: dict[str, dict] = {}
        pipeline_status = "completed"

        # Dependency resolution runs first, before triage
        steps.append("dependency_resolution")
        results["dependency_resolution"] = {
            "status": "queued",
            "task": "workers.tasks.dependency_resolver.resolve_dependencies",
        }

        if "skip_quality_analyze" not in issue_data:
            steps.append("quality_analyze")
            results["quality_analyze"] = {
                "status": "queued",
                "task": "workers.quality.analyzer.quality_analyze",
            }

        steps.append("agent_dispatch")
        results["agent_dispatch"] = {
            "status": "queued",
            "task": "workers.tasks.agent.dispatch_opencode",
        }

        steps.append("verification")
        results["verification"] = {
            "status": "queued",
            "task": "workers.tasks.verification.run_verification",
        }

        steps.append("self_audit")
        results["self_audit"] = {
            "status": "queued",
            "task": "workers.tasks.self_audit.run_self_audit",
        }

        steps.append("anti_mockup_scan")
        results["anti_mockup_scan"] = {
            "status": "queued",
            "task": "workers.quality.anti_mockup_scan.anti_mockup_scan",
        }

        steps.append("pr_creation")
        results["pr_creation"] = {
            "status": "queued",
            "task": "workers.tasks.pr_creation.create_pull_request",
        }

        steps.append("review")
        results["review"] = {
            "status": "queued",
            "task": "workers.tasks.self_audit.review_decision",
        }

        return {
            "issue_data": issue_data,
            "pipeline_steps": steps,
            "pipeline_results": results,
            "pipeline_status": pipeline_status,
        }
    except Exception as exc:
        logger.error("Pipeline orchestration failed \u2014 %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.self_audit.review_decision",
    autoretry_for=(Exception,),
)
def review_decision(self, pipeline_results: dict) -> dict:
    logger.info("Making review decision from pipeline results")
    try:
        all_passed = True
        failures: list[str] = []

        for step_name, step_result in pipeline_results.items():
            status = step_result.get("status", "unknown")
            if status != "completed":
                all_passed = False
                failures.append(f"{step_name}: {status}")

        self_audit = pipeline_results.get("self_audit", {})
        if self_audit.get("passed") is False:
            all_passed = False
            failures.append("self_audit: failed \u2014 missing items or anti-mockup findings present")

        anti_mockup = pipeline_results.get("anti_mockup_scan", {})
        if anti_mockup.get("passed") is False:
            all_passed = False
            failures.append("anti_mockup_scan: failed \u2014 critical or blocking findings present")

        decision = "pass" if all_passed else "rework"
        logger.info("Review decision: %s \u2014 failures=%s", decision, failures)

        return {
            "decision": decision,
            "passed": all_passed,
            "failures": failures,
            "pipeline_results": pipeline_results,
        }
    except Exception as exc:
        logger.error("Review decision failed \u2014 %s", exc, exc_info=True)
        raise self.retry(exc=exc)
