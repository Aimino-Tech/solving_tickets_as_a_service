import { Router } from 'express';

const router: Router = Router();

router.get('/auth/github', (_req, res) => {
  res.status(501).json({ error: 'GitHub OAuth not configured' });
});

router.get('/auth/github/callback', (_req, res) => {
  res.status(501).json({ error: 'GitHub OAuth not configured' });
});

export { router as gitHubOAuthRouter };
