/**
 * Ambient declaration for the optional SAML SSO routes module.
 *
 * This module is loaded dynamically and may not be present in all deployments.
 * The declaration allows TypeScript to type-check the dynamic import without
 * requiring the actual file to exist.
 */

import type { Router } from 'express';

declare const samlRouter: Router;
export default samlRouter;
