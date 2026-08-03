# Security Key Management

## GitHub App Private Key

### Location

The GitHub App private key (`GITHUB_PRIVATE_KEY` or loaded from `.syntaro-private-key.pem`) is used to authenticate as the GitHub App and generate installation tokens.

### Convention

- **Development**: Store in `.env` as `GITHUB_PRIVATE_KEY` (this file is gitignored)
- **Production**: Inject via environment variables or secret manager (Railway secrets, Docker secrets, Kubernetes secrets, etc.)
- **Never**: Commit the PEM file to the repository

### Rotation Process

When rotating the private key:

1. **Generate new key**: Go to GitHub App Settings → General → Private Keys → Generate a private key
2. **Download** the new `.pem` file
3. **Replace** the value of `GITHUB_PRIVATE_KEY` in all deployment environments
4. **Verify** the new key works by checking `/health` endpoint
5. **Delete** the old PEM file from all systems

### Git Protection

- `.syntaro-private-key.pem` is in `.gitignore`
- `syntaro-private-key.pem` (without dot) is also in `.gitignore`
- `*.pem` wildcard also catches accidental PEM commits
- `*.key` wildcard catches key files

### Audit

If a PEM file was accidentally committed:
1. Use `git filter-repo` or `BFG Repo-Cleaner` to scrub history
2. Rotate the key immediately (see above)
3. Review GitHub App access logs for unauthorized use
