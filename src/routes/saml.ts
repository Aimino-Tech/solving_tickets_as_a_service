import { Router, type Request, type Response } from 'express';
const router: Router = Router();
router.get('/metadata', (_req: Request, res: Response) => res.status(501).json({ error: 'SAML not configured' }));
export default router;
