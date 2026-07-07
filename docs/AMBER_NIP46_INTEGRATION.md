# Amber / NIP-46 Signer Integration Analysis

**Date:** 2026-07-07  
**Context:** Login flow now works (Content-Type fix deployed), but user needs to configure their npub as admin. Considering whether to integrate Amber as an embedded signer.

---

## Current State

- **Login flow:** Challenge → sign with NIP-07 (nos2x-fox/Plebeian Signer) → verify → session token
- **Problem:** User must have a browser extension installed AND configure their npub in the agent config
- **Error after fix:** "Agent rejected signature: pubkey is not admin npub" — the login flow works, but the agent doesn't recognize the signing key

---

## What is Amber?

[Amber](https://github.com/greenart7c3/Amber) is an Android app that acts as a **NIP-46 remote signer**. It:

- Stores nsec on the user's phone (never leaves the device)
- Exposes a `bunker://` URL for web apps to connect to
- Signs events when prompted (user sees a confirmation dialog on their phone)
- Supports multiple accounts
- Works offline (no server needed — phone and browser communicate locally)

Amber implements **NIP-46** ("Nostr Remote Signing"), not NIP-07 (browser extension API).

---

## Amber vs NIP-07 Browser Extension

| Aspect | NIP-07 (nos2x-fox / Plebeian Signer) | NIP-46 (Amber) |
|--------|---------------------------------------|-----------------|
| Where key lives | Browser extension storage | Phone app |
| User interaction | Extension popup | Phone notification |
| Setup | Install extension + import key | Install app + import key + pair with browser |
| Multiple apps | Works on any site automatically | Each app pairs separately |
| Security | Key in browser = same attack surface as browser | Key on separate device = better isolation |
| Mobile support | Desktop only (extension) | Android native |
| Connection | Same device | Local network (phone ↔ browser) |

---

## Integration Options

### Option A: Deploy Amber alongside Continuum (user's suggestion)

**What this means:** Bundle Amber's NIP-46 client into the Continuum SPA so users can connect via Amber without needing a browser extension.

**Required changes:**

1. **Add NIP-46 client library** to the frontend (e.g. `nostr-tools` already has NIP-46 support, or use `@snort/nip46`)
2. **Add "Connect via Amber" button** in the login modal alongside the existing extension flow
3. **Bunker connection flow:**
   - User scans a QR code or pastes a `bunker://` URL from Amber
   - SPA connects to Amber via local WebSocket
   - Amber prompts user on phone: "Sign login challenge?"
   - User approves → event signed → agent verifies → session token issued
4. **Fall back to NIP-07** if no Amber connection is available

**Estimated effort:** 3-5 days (NIP-46 is complex — key exchange, encryption, WebSocket management)

**Limitations:**
- Amber is Android-only. iOS users would need a different signer
- The phone must be on the same network as the browser
- NIP-46 adds latency (every sign operation goes through the phone)
- Amber's bunker protocol is still evolving

### Option B: Multi-admin npub support (simpler fix)

**What this means:** Change the agent to accept multiple admin npubs instead of one. The user adds their npub from nos2x-fox to the config.

**Required changes:**
1. Change `admin_npub: "npub1..."` to `admin_npubs: ["npub1...", "npub2..."]` in config
2. Update `auth.mjs` `verifyChallenge()` to check against all allowed npubs
3. Update `verifySessionToken()` similarly
4. Add config validation for the array

**Estimated effort:** 1-2 hours (simple config change + array iteration)

### Option C: Deploy a browser-based signer as part of the SPA

**What this means:** Embed a minimal NIP-07 signer directly in the Continuum web app, so users don't need a separate extension. The key is stored in the browser's local storage (encrypted with a PIN/password).

**Required changes:**
1. Add key generation + encrypted storage to the SPA
2. Implement `window.nostr` interface within the app
3. Add PIN-protected unlock flow
4. Handle key import (nsec/npub)

**Estimated effort:** 2-3 days (NIP-07 implementation, encryption, UX)

**Security concern:** This defeats the purpose of NIP-07 — the key is in the browser's JS context, which is the largest attack surface. Recommended against for production.

---

## Recommendation

**Short-term (this week):** Option B — multi-admin npub support. The fix is trivial (1 hour) and unblocks the user immediately. The login flow is already working end-to-end, they just need to add their npub to the allowed list.

**Medium-term (next sprint):** Option A — Amber/NIP-46 integration. This is the right architectural direction: the user's key lives on their phone, not in any browser. The SPA talks to Amber via NIP-46. This provides:
- Better security (key on separate device)
- No browser extension dependency
- Phone as the canonical signing device
- Works with any NIP-46 signer (Amber, other apps)

**Not recommended:** Option C — embedding a signer in the SPA. This reduces security and contradicts the Nostr principle of keeping keys out of web apps.

---

## Multi-Admin Config Change (Option B — Quick Fix)

### Config change

```yaml
# Before (single npub):
admin_npub: "npub1REPLACE..."

# After (array):
admin_npubs:
  - "npub1REPLACE_WITH_YOUR_NPUB"
  # Add more npubs as needed
```

### Code change (auth.mjs)

```javascript
// Before (line 46-52):
const decoded = nip19.decode(cfg.admin_npub);
if (decoded.type !== 'npub') throw new Error('not an npub');
adminHex = decoded.data;

// After:
const adminHexes = cfg.admin_npubs.map(npub => {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') throw new Error(`not an npub: ${npub}`);
  return decoded.data;
});
```

```javascript
// Before (verifyChallenge, line 73):
if (event.pubkey !== adminHex) return { ok: false, reason: 'pubkey is not admin npub' };

// After:
if (!adminHexes.includes(event.pubkey)) return { ok: false, reason: 'pubkey is not an admin npub' };
```

```javascript
// Before (verifySessionToken, line 135):
if (pk !== adminHex) return { ok: false, reason: 'not admin pubkey' };

// After:
if (!adminHexes.includes(pk)) return { ok: false, reason: 'not an admin pubkey' };
```

---

## Amber/NIP-46 Integration (Option A — Medium-term)

### Architecture

```
┌──────────────┐     NIP-46 bunker      ┌──────────────┐
│  Continuum   │ ◄──── WebSocket ────►  │  Amber (Phone)│
│  SPA (browser)│                        │  (nsec stored)│
│              │     sign challenge      │              │
│  auth.js     │ ────► signEvent ────►  │  signEvent() │
│              │ ◄─── signed event ◄──  │              │
└──────┬───────┘                        └──────────────┘
       │
       │ POST /api/auth/verify {event}
       ▼
┌──────────────┐
│  Agent (VPS) │
└──────────────┘
```

### Implementation steps

1. **Add `@snort/nip46` or implement raw NIP-46 client** — handles bunker connection, encryption, event signing
2. **Add Amber connection UI** — QR code scanner or text input for `bunker://` URL
3. **Modify auth.js `startLogin()`** — add Amber path alongside NIP-07 path
4. **Handle connection state** — Amber may disconnect; show reconnection UI
5. **Fallback logic** — if no Amber and no NIP-07, show both options

### NIP-46 client example (pseudocode)

```javascript
import { Nip46 } from '@snort/nip46';

async function loginWithAmber(bunkerUrl) {
  const signer = new Nip46(bunkerUrl, {
    clientName: 'Continuum',
    clientUrl: window.location.origin,
  });
  await signer.init();

  // Get pubkey from phone
  const pubkey = await signer.getPublicKey();

  // Sign challenge through phone
  const challenge = await requestChallenge();
  const signed = await signer.signEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    content: challenge,
    tags: [['challenge', challenge], ['relay', window.location.origin]],
  });

  const verified = await verifyChallenge(signed);
  if (verified.ok) {
    // Session established
  }
}
```
