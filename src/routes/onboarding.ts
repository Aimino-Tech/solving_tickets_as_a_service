import { Router, Request, Response } from "express";
import { onboardingService } from "../services/onboarding.js";

const router = Router();

router.get("/api/onboarding/status/:tenantId", (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const state = onboardingService.getState(tenantId);
  if (!state) {
    res.json({
      tenantId,
      onboarded: false,
      currentStep: "github_app_install",
      state: null,
    });
    return;
  }
  res.json({
    tenantId,
    onboarded: onboardingService.isComplete(tenantId),
    currentStep: onboardingService.getCurrentStep(tenantId),
    nextStep: onboardingService.getNextStep(tenantId),
    state,
  });
});

router.post("/api/onboarding/step/:tenantId", (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const { stepName, metadata } = req.body as { stepName?: string; metadata?: Record<string, unknown> };
  if (!stepName) {
    res.status(400).json({ error: "stepName is required" });
    return;
  }
  const state = onboardingService.markStepCompleted(tenantId, stepName);
  if (metadata) {
    onboardingService.updateStep(tenantId, { metadata: { ...(state.metadata || {}), [stepName]: metadata } });
  }
  res.json({
    success: true,
    currentStep: onboardingService.getCurrentStep(tenantId),
    nextStep: onboardingService.getNextStep(tenantId),
    state,
  });
});

router.get("/api/onboarding/github-login-url", (_req: Request, res: Response) => {
  const clientId = process.env.GITHUB_APP_CLIENT_ID || "";
  const redirectUri = process.env.GITHUB_APP_REDIRECT_URI || "";
  if (!clientId) {
    res.status(500).json({ error: "GitHub App not configured" });
    return;
  }
  const url = `https://github.com/apps/${clientId}/installations/new`;
  res.json({ url, clientId, redirectUri });
});

router.get("/api/onboarding/linear-login-url", (_req: Request, res: Response) => {
  const clientId = process.env.LINEAR_CLIENT_ID || "";
  if (!clientId) {
    res.status(500).json({ error: "Linear OAuth not configured" });
    return;
  }
  const redirectUri = process.env.LINEAR_REDIRECT_URI || "http://localhost:3000/api/onboarding/linear-callback";
  const url = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,write,issues:create`;
  res.json({ url, clientId, redirectUri });
});

router.post("/api/onboarding/linear-callback", async (req: Request, res: Response) => {
  const { code, tenantId } = req.body as { code?: string; tenantId?: string };
  if (!code || !tenantId) {
    res.status(400).json({ error: "code and tenantId are required" });
    return;
  }
  try {
    const clientId = process.env.LINEAR_CLIENT_ID || "";
    const clientSecret = process.env.LINEAR_CLIENT_SECRET || "";
    const redirectUri = process.env.LINEAR_REDIRECT_URI || "http://localhost:3000/api/onboarding/linear-callback";
    const tokenRes = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      res.status(502).json({ error: `Linear OAuth failed: ${errorText}` });
      return;
    }
    const tokenData = await tokenRes.json();
    onboardingService.markStepCompleted(tenantId, "linear_oauth");
    res.json({
      success: true,
      message: "Linear OAuth completed",
      tenantId,
      currentStep: onboardingService.getCurrentStep(tenantId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Linear OAuth callback error: ${msg}` });
  }
});

router.post("/api/onboarding/select-repos/:tenantId", (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const { repos } = req.body as { repos?: string[] };
  onboardingService.markStepCompleted(tenantId, "repo_selection");
  onboardingService.updateStep(tenantId, { metadata: { repos } });
  res.json({
    success: true,
    repos,
    currentStep: onboardingService.getCurrentStep(tenantId),
  });
});

router.post("/api/onboarding/configure-labels/:tenantId", (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const { labels } = req.body as { labels?: Record<string, string> };
  onboardingService.markStepCompleted(tenantId, "label_config");
  onboardingService.updateStep(tenantId, { metadata: { labels } });
  res.json({
    success: true,
    labels,
    currentStep: onboardingService.getCurrentStep(tenantId),
  });
});

router.post("/api/onboarding/test-issue/:tenantId", async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  try {
    const celeryUrl = process.env.CELERY_TASK_API_URL || "http://localhost:3000/api/dispatch";
    const dispatchRes = await fetch(celeryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        issueId: `onboarding-test-${tenantId}`,
        repo: "test-repo",
        title: "Onboarding Test Issue",
        body: "This is an auto-generated test issue for onboarding verification.",
        label: "stas:fix",
      }),
    });
    if (!dispatchRes.ok) {
      const errorText = await dispatchRes.text();
      res.status(502).json({ error: `Test issue dispatch failed: ${errorText}` });
      return;
    }
    onboardingService.markStepCompleted(tenantId, "test_issue");
    onboardingService.markStepCompleted(tenantId, "complete");
    res.json({
      success: true,
      message: "Test issue dispatched and pipeline verified",
      tenantId,
      onboarded: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Test issue failed: ${msg}` });
  }
});

export default router;
