import { gitHubOAuthRepository } from './src/db/repositories/GitHubOAuthRepository.js';
import { decrypt } from './src/utils/encryption.js';
import { authService } from './src/auth/service.js';
const payload = authService.verifyToken(process.env.JWT);
const t = await gitHubOAuthRepository.findByUserId(payload.sub);
const enc = t && (t.access_token_encrypted ?? t.accessTokenEncrypted);
if (!enc) { console.error('no token'); process.exit(1); }
process.stdout.write(decrypt(enc));
