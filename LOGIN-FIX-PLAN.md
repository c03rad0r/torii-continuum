# Login Error Fix Plan — "Could not reach agent: Bad Request"

## Root Cause

The frontend HTTP client (`src/data/agent.js`) unconditionally sets `Content-Type: application/json` on every request. When `requestChallenge()` calls `req('POST', '/api/auth/challenge')` with no body, the browser sends an empty request body with `Content-Type: application/json`. The agent's Fastify server rejects this with:

```json
{"statusCode":400,"code":"FST_ERR_CTP_EMPTY_JSON_BODY","error":"Bad Request",
 "message":"Body cannot be empty when content-type is set to 'application/json'"}
```

The frontend then displays: **"Could not reach agent: Bad Request"**

## Fix (Already Applied in Repo)

`src/data/agent.js` lines 63-71 — only set `Content-Type` when there is a body:

```js
// OLD (bug):
const headers = {'Content-Type': 'application/json'};

// NEW (fix):
const headers = {};
// ... later, only when body is present:
if (body !== undefined && body !== null) {
  bodyStr = JSON.stringify(body);
  headers['Content-Type'] = 'application/json';
}
```

This fix is already committed on the `feat/ansible-one-click-deploy` branch. It must be deployed.

---

## Task 1: Deploy the Frontend Fix to VPS1

### What
Rebuild and deploy the Continuum frontend on VPS1 with the fixed `agent.js`.

### Steps
1. SSH into VPS1 (`66.92.204.38`, user `debian`)
2. Clone/pull the latest repo with the fix
3. Install dependencies: `npm ci`
4. Build frontend: `VITE_AGENT_URL=https://agent.orangesync.tech npm run build`
5. Copy built assets to the Caddy serve directory
6. Reload Caddy if needed
7. Verify: visit `https://continuum.orangesync.tech`, click "Login" — should no longer show "Bad Request"

### Verification
```bash
curl -s -X POST -H "Content-Type: application/json" \
  https://agent.orangesync.tech/api/auth/challenge
```
Should return 400 with "Bad Request" if hitting the OLD code.
Should return 200 with `{challenge, expires_in, kind}` if fixed (because browser no longer sends Content-Type with empty body).

### Rollback
If the fix causes issues, revert to the previous bundle.

---

## Task 2: Verify CORS Configuration on VPS1

### What
The agent's `config.yaml` must include `https://continuum.orangesync.tech` in its CORS allowlist. If missing, the browser blocks the login request with a CORS error instead of "Bad Request".

### Steps
1. SSH into VPS1
2. Read `/home/continuum/agent/repo/agent/config.yaml`
3. Check `server.cors_origins` contains `https://continuum.orangesync.tech`
4. If missing, add it and restart the agent: `sudo systemctl restart continuum-agent`

### Verification
```bash
curl -s -X OPTIONS -H "Origin: https://continuum.orangesync.tech" \
  -H "Access-Control-Request-Method: POST" \
  https://agent.orangesync.tech/api/auth/challenge -D - | grep access-control-allow-origin
# Expected: access-control-allow-origin: https://continuum.orangesync.tech
```

---

## Task 3: Add CORS Support for Firefox NIP-07 Extensions (nos2x-fox)

### What
The user has **nos2x-fox** (a Firefox NIP-07 extension by diegogurpegui) instead of Plebeian Signer. The NIP-07 interface is standardized — both expose `window.nostr.signEvent`. No code changes needed for compatibility.

However, Firefox handles CORS and `credentials: 'include'` slightly differently than Chrome. Ensure:
- The agent config includes `https://continuum.orangesync.tech` in `cors_origins`
- The server sets `credentials: true` (it already does — line 54 of agent/index.mjs)
- The `Vary: Origin` header is present (Caddy adds this automatically)

### Steps
1. Verify the agent CORS config includes the frontend origin
2. Test login from Firefox with nos2x-fox installed
3. If login fails with a CORS error, add `Access-Control-Allow-Origin` specific handling

### Verification
1. Install nos2x-fox in Firefox
2. Configure it with the same npub as `admin_npub` in the agent config
3. Visit `https://continuum.orangesync.tech`
4. Click "Login" — should show the NIP-07 signer challenge
5. nos2x-fox should prompt to sign the challenge
6. After signing, the page should show "Sign out" button

---

## Task 4: Add Playwright Test for Login Error Handling

### What
Add a test that verifies the frontend shows the correct error when the agent returns "Bad Request", and that the fix prevents this error.

### Steps
1. Write Playwright test that:
   - Sets `window.__CONTINUUM_AGENT_URL__` to a URL that returns 400
   - Clicks Login
   - Verifies the error message is NOT shown
2. Write Playwright test that:
   - Logs in via the programmatic NIP-42 flow
   - Verifies the session button says "Sign out"
   - This proves the fixed code works

### Verification
```bash
npx playwright test auth-tests.spec.ts --config playwright.config.ts --grep "X01"
# Should pass - session button shows "Sign out"
```

---

## Summary

| Task | Priority | Effort | Dependency | Status |
|------|----------|--------|------------|--------|
| **1. Deploy frontend fix to VPS1** | 🔴 Critical | 30 min | SSH access to VPS1 | **Not done** |
| **2. Verify CORS config on VPS1** | 🔴 Critical | 15 min | SSH access to VPS1 | **Not done** |
| **3. Verify nos2x-fox works** | 🟡 Medium | 1 hour | User's Firefox browser | **Not done** |
| **4. Add Playwright error-handling test** | 🟢 Low | 1 hour | Nothing | **Not done** |

The fix is already committed in the repo. What's needed is deployment to production.
