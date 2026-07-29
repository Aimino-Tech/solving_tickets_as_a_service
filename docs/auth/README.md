# STAS Auth — UX Flow Documentation

## Overview

STAS uses GitHub OAuth for authentication. The auth flow is:

```
User → Login Page → GitHub OAuth → Callback → JWT Token → Dashboard
```

No email/password signup. All authentication is delegated to GitHub OAuth 2.0.

---

## User Flow Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│              │     │              │     │              │     │              │
│  /login      │────>│  GitHub.com  │────>│  /callback   │────>│  Dashboard   │
│  (unauthed)  │     │  OAuth Page  │     │  (token      │     │  (authed)    │
│              │     │              │     │   exchange)  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                                                             │
       │  401 on any API call                                        │  logout
       ▼                                                             ▼
┌──────────────┐                                          ┌──────────────┐
│              │                                          │              │
│  /login      │                                          │  Token       │
│  (redirect)  │                                          │  cleared     │
│              │                                          │              │
└──────────────┘                                          └──────────────┘
```

### Flow Steps

1. **User visits any dashboard page** → `AuthContext` checks localStorage for `stas_token`
2. **No token** → Show login page at `/login`
3. **User clicks "Sign in with GitHub"** → Redirect to `/api/auth/github`
4. **Server redirects to GitHub OAuth** → User authorizes on GitHub.com
5. **GitHub redirects back** to `/api/auth/callback?code=...&state=...`
6. **Server exchanges code for access token** → Fetches GitHub user info → Signs JWT
7. **Server redirects to dashboard** → `http://localhost:5173/auth/callback?token=<JWT>`
8. **`AuthContext` detects token in URL** → Stores in localStorage → Calls `/api/auth/me`
9. **Dashboard loads** with authenticated user info

---

## UI States & Screenshots

> Screenshots should be captured after deploying and running the dashboard locally.
> See [Screenshots Guide](#capturing-screenshots) below.

### 1. Login Page (Unauthenticated)

- **File**: `dashboard/src/pages/Login.tsx`
- **Route**: `/login`
- **States**:
  - Empty/default: Shows "Welcome back" heading + "Sign in with GitHub" button
  - Loading: Button disabled during redirect (no loading state currently — improvement opportunity)
  - Error: 503 if GitHub OAuth not configured (shows error response)
- **Screenshot**: Login with GitHub branding on the left, sign-in card on the right

### 2. GitHub OAuth Page

- **URL**: GitHub.com login/oauth/authorize
- **States**:
  - Authorization prompt: "STAS wants to access your account"
  - Scopes requested: `read:user`, `user:email`
  - User can authorize or cancel
- **Screenshot**: GitHub OAuth authorization dialog

### 3. Callback / Token Exchange

- **Route**: `GET /api/auth/callback`
- **Server-side**: URL visible briefly as browser redirects
- **States**:
  - Success: Redirects to dashboard with JWT token in query param
  - CSRF failure (state mismatch): Returns 401 "Invalid state parameter"
  - Code exchange failure: Returns 401 "Failed to exchange authorization code"
  - GitHub API failure: Returns 502 "Failed to fetch user info from GitHub"
- **Screenshot**: Brief redirect — hard to capture. Test with curl instead.

### 4. Dashboard (Authenticated)

- **Route**: `/` or `/dashboard`
- **States**:
  - Loading: Shows spinner while `AuthContext` calls `/api/auth/me`
  - Authenticated: Shows dashboard with user avatar, username, and features
  - Token expired: 401 → redirect to `/login` (handled in `client.ts`)
- **Screenshot**: Dashboard with user avatar in header, active runs list

### 5. Logged Out State

- User clicks logout → token cleared from localStorage → redirected to `/login`
- **Screenshot**: Login page after logout

### 6. Rate Limiting Error Toast

- When rate-limited, API returns 429 → dashboard shows error toast
- **Visual**: Red/orange toast at top of screen
- **Screenshot**: Dashboard with rate limit error toast visible

---

## Capturing Screenshots

### Prerequisites
1. Deploy the dashboard and API server locally
2. Have a GitHub account for testing
3. Configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`

### Using Playwright (Recommended)

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Screenshot 1: Login page
await page.goto('http://localhost:5173/login');
await page.screenshot({ path: 'docs/auth/screenshots/login-page.png' });

// Screenshot 2: Dashboard (after auth)
// Manually authenticate first, then:
await page.goto('http://localhost:5173/dashboard');
await page.waitForSelector('[data-testid="dashboard-content"]');
await page.screenshot({ path: 'docs/auth/screenshots/dashboard-authed.png' });

// Screenshot 3: Logged out
await page.goto('http://localhost:5173/api/auth/logout');
await page.screenshot({ path: 'docs/auth/screenshots/logged-out.png' });

await browser.close();
```

### Using Browser DevTools
1. Open browser DevTools (F12)
2. Set viewport to 1440×900
3. Navigate to each page state
4. Use "Capture screenshot" (Ctrl+Shift+P → "Capture screenshot")
5. Save to `docs/auth/screenshots/`

### Screenshot File Naming
```
docs/auth/screenshots/
  login-page.png              # Login page default state
  login-error.png             # Login page with error (if OAuth not configured)
  github-oauth-page.png       # GitHub OAuth authorization dialog
  dashboard-authed.png        # Dashboard after successful authentication
  dashboard-loading.png       # Dashboard loading state (token check in progress)
  dashboard-error.png         # Dashboard with error toast (rate-limited or 401)
  logged-out.png              # Page after logout redirect to /login
```

---

## API Endpoint Reference

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/api/auth/github` | No | Redirect to GitHub OAuth authorization page |
| GET | `/api/auth/callback` | No (OAuth state cookie) | GitHub OAuth callback — exchange code for JWT |
| GET | `/api/auth/me` | Yes (JWT Bearer) | Return current authenticated user info |
| POST | `/api/auth/logout` | Yes (JWT Bearer) | Invalidate session (client-side token removal) |

### Source Files

| File | Purpose |
|------|---------|
| `premium/src/routes/auth.ts` | Express router for all auth endpoints |
| `premium/src/middleware/auth.ts` | JWT verification middleware (`jwtAuth`) |
| `dashboard/src/context/AuthContext.tsx` | React context for auth state management |
| `dashboard/src/pages/Login.tsx` | Login page UI |
| `dashboard/src/api/client.ts` | API client with token handling and 401 redirect |

---

## Token Lifecycle

### Token Creation
```
GitHub OAuth callback → Server verifies code → Fetches GitHub user
→ Signs JWT with secret → Returns token in redirect URL
→ Frontend stores in localStorage as 'stas_token'
```

### Token Format (JWT)
```json
{
  "sub": "12345678",         // GitHub user ID
  "username": "octocat",     // GitHub username
  "avatar_url": "https://...", // GitHub avatar
  "iat": 1712345678,         // Issued at
  "exp": 1712349278,         // Expiry (1 hour)
  "iss": "stas-premium"      // Issuer
}
```

### Token Verification Flow
```
Request → jwtAuth middleware → Extract Bearer token
→ Verify JWT signature → Check expiry → Attach user to req.user
→ Forward to route handler
→ If invalid/expired → Return 401
```

### Token Lifecycle Diagram
```
┌─────────────────────────────────────────────────────────┐
│                   Token Lifecycle                        │
├──────────────┬──────────────────┬───────────────────────┤
│  Stage       │  What Happens    │  Storage              │
├──────────────┼──────────────────┼───────────────────────┤
│  Created     │  OAuth callback  │  URL query param      │
│  Stored      │  AuthContext     │  localStorage          │
│  Used        │  Every API call  │  Authorization header │
│  Verified    │  jwtAuth         │  Server-side verify   │
│  Expired     │  60 min TTL      │  401 response         │
│  Refreshed   │  (N/A currently) │  Must re-auth via OAuth │
│  Cleared     │  Logout          │  localStorage.remove  │
└──────────────┴──────────────────┴───────────────────────┘
```

### Current Limitations

- **No refresh token rotation**: When the JWT expires (1 hour), the user must re-authenticate via GitHub OAuth
- **No server-side session invalidation**: Logout is client-side only (token removal from localStorage)
- **No token blacklist**: A leaked token remains valid until expiry

---

## Error States & Handling

### 401 Unauthorized
```typescript
// dashboard/src/api/client.ts:34-38
if (res.status === 401) {
  clearToken();
  if (!path.includes('/auth/login') && !path.includes('/auth/register')) {
    window.location.href = '/login';
  }
  throw new Error('Unauthorized');
}
```
- Triggers on expired/missing/invalid JWT
- Clears localStorage token
- Redirects to `/login` (except for login/register endpoints)
- All callers receive "Unauthorized" error if redirect doesn't happen

### 503 Service Unavailable (OAuth not configured)
```json
{ "error": "GitHub OAuth not configured" }
```
- Returned when `GITHUB_CLIENT_ID` is not set in environment
- Login page should display this error to the user

### CSRF Protection (OAuth state mismatch)
```json
{ "error": "Invalid state parameter" }
```
- Server sets `oauth_state` cookie before redirecting to GitHub
- Callback verifies state parameter matches cookie
- Prevents CSRF attacks on the OAuth callback

---

## Frontend Auth Implementation

### AuthContext (`dashboard/src/context/AuthContext.tsx`)
- **Provider**: Wraps the entire app
- **On mount**: Checks URL for token (OAuth callback) and localStorage for existing token
- **If found**: Calls `/api/auth/me` to validate and get user info
- **If valid**: Sets user state → `isAuthenticated = true`
- **If invalid**: Clears token → redirects to `/login`
- **Login action**: Redirects browser to `/api/auth/github`
- **Logout action**: Calls `/api/auth/logout` (best-effort), clears token, clears user state

### Protected Routes
Protected routes check `isAuthenticated` from `AuthContext`. If not authenticated, they redirect to `/login`.

### Token Storage
- **Storage key**: `stas_token` in `localStorage`
- **Set**: After OAuth callback via URL parameter
- **Get**: Before each API request
- **Clear**: On 401 response or explicit logout

---

## Testing

### Manual Test Flow
1. Visit `http://localhost:5173` → should redirect to `/login`
2. Click "Sign in with GitHub" → should redirect to GitHub OAuth
3. Authorize the app → should redirect back to dashboard
4. Dashboard should show authenticated state with user info
5. Clear `stas_token` from localStorage → refresh → should show login page
6. Click logout → should clear token and show login page

### Automated Tests
- `dashboard/src/__tests__/context/AuthContext.test.tsx` — AuthContext unit tests
- `dashboard/src/__tests__/dashboard/client.test.ts` — API client tests
- `src/__tests__/premium/routes/auth.test.ts` — Auth route handler tests (currently skipped)
