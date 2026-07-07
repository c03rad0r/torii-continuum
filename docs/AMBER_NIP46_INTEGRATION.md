# NIP-46 Bunker Integration — Server-Side Signer for Continuum

**Date:** 2026-07-07
**Context:** Login flow works (Content-Type fix deployed), but requires browser extension (nos2x-fox / Plebeian Signer). User wants server-side signer alongside Continuum so no extension needed.

---

## The Core Insight: Amber Is Not What We Need

[Amber](https://github.com/greenart7c3/Amber) is an **Android phone app** that acts as a NIP-46 remote signer. It keeps the nsec on the phone and connects to web apps via local network WebSocket. It is NOT deployable as a server-side component.

What the user's suggestion actually maps to: **Deploy a NIP-46 bunker server-side** alongside the Continuum agent. The bunker manages nsecs on the VPS and provides a WebSocket endpoint the frontend connects to directly — no phone, no browser extension.

---

## Architecture: Agent-Side NIP-46 Bunker

```
┌─────────────────────────┐     WebSocket (NIP-46)      ┌──────────────────────────┐
│  Continuum SPA          │ ◄────────────────────────►  │  Agent on VPS            │
│  (user's browser)       │                              │                          │
│                         │  1. bunker://connect         │  /api/nip46/connect     │
│  auth.js connects to    │  2. signEvent(challenge)     │  (WebSocket endpoint)    │
│  agent's NIP-46         │  3. getPublicKey()           │  ┌────────────────────┐ │
│  WebSocket directly     │ ◄── signed event ───────    │  │ NIP-46 Bunker      │ │
│                         │                              │  │ (Go / Node.js)     │ │
│  NO browser extension   │                              │  │                    │ │
│  NO phone needed        │                              │  │ admin_nsec stored   │ │
│                         │                              │  │ in config.yaml     │ │
│                         │                              │  └────────────────────┘ │
└─────────────────────────┘                              └──────────────────────────┘
```

### How It Works

1. **Agent starts** with `admin_nsec` in config (already there)
2. **Agent exposes** a NIP-46 WebSocket endpoint at `wss://agent.continuum.com/api/nip46`
3. **Frontend loads** and auto-connects to the NIP-46 bunker via WebSocket
4. **Login flow** uses the NIP-46 connection instead of `window.nostr`:
   - `signer.getPublicKey()` → returns admin pubkey
   - `signer.signEvent(challenge)` → agent signs internally
   - No popup, no extension dialog, no phone notification
5. **Session token** returned as before — seamless

### Why This Is Better Than Browser Extensions

| Aspect | NIP-07 Extension (current) | NIP-46 Bunker (proposed) |
|--------|---------------------------|--------------------------|
| UX | Install extension, import key, configure | Nothing — works out of the box |
| nsec location | Browser extension storage | Server config (encrypted at rest) |
| Multi-device | Each browser needs extension | One server, any browser |
| Admin changes | Update every browser | Update one config file |
| Attack surface | Browser extensions are high-risk | Server-side, auditable |

---

## Implementation Options

### Option 1: NIP-46 in the Agent Itself (Recommended)

The agent (Go) already handles auth, sessions, and wallet. Adding a NIP-46 WebSocket handler is the most integrated approach.

**Required changes:**

1. **Agent (Go):** Add NIP-46 WebSocket endpoint (`/api/nip46`)
   - Uses `nostr-sdk` or `nips` Go library for NIP-46 protocol
   - Manages one signing key (the admin nsec)
   - Authenticates WebSocket connections via session token or origin check
   
2. **Frontend (JS):** Replace `window.nostr.signEvent()` with NIP-46 client
   - Use `@nostr/nip46` or raw WebSocket + NIP-46 encryption
   - Auto-connect on app load when `VITE_AGENT_URL` is configured
   - Fall back to `window.nostr` if NIP-46 connection fails (for non-admin users)

**Estimated effort:** 1-2 weeks (NIP-46 is a complex protocol — E2E encryption, event signing over WebSocket)

### Option 2: nsecbunker Sidecar

Deploy [nsecbunker](https://github.com/kind0/nsecbunker) as a sidecar container alongside the agent.

- Python NIP-46 bunker implementation
- Runs on a separate port, agent proxies `/api/nip46` → sidecar
- Manages keys in SQLite
- Adds another moving part (sidecar process)

**Estimated effort:** 3-5 days (deploy + configure + proxy + test)

### Option 3: Minimal NIP-46 Shim in Agent (MVP — Recommended First Step)

The absolute simplest approach: add a minimal NIP-46 WebSocket to the agent that **only handles the login flow**:

1. Agent exposes `wss://agent.continuum.com/api/nip46` as a simple WebSocket
2. The WebSocket accepts two messages:
   - `get_public_key` → returns admin pubkey
   - `sign_event` → signs the provided event with admin nsec
3. Frontend connects, gets pubkey, sends challenge event, gets signature back
4. Agent then uses the signature to complete the verify flow (same as NIP-07 path)

This is NOT a full NIP-46 implementation (no E2E encryption, no bunker protocol negotiation), but it's a **functional signer** that eliminates the browser extension dependency.

**Estimated effort:** 4-8 hours (agent WebSocket + frontend client)

---

## Recommended Path

| Phase | What | When | Effort |
|-------|------|------|--------|
| **Now** | Deploy Content-Type fix + multi-admin npub support | Done / hours | 1h |
| **Phase 1** | Minimal NIP-46 shim (Option 3) | This week | 4-8h |
| **Phase 2** | Proper NIP-46 bunker in agent (Option 1) | Next sprint | 1-2w |
| **Phase 3** | Multi-user bunker + key rotation | Future | 2-3w |

---

## Frontend Changes (auth.js)

The `src/data/agent.js` module already handles all agent communication. Adding NIP-46 support means adding a `Nip46Signer` class:

```javascript
// src/data/agent.js — new NIP-46 signer path

class Nip46Signer {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.pubkey = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  async getPublicKey() {
    if (this.pubkey) return this.pubkey;
    const resp = await this.send({ type: 'get_public_key' });
    this.pubkey = resp.pubkey;
    return this.pubkey;
  }

  async signEvent(event) {
    return this.send({ type: 'sign_event', event });
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.ws.send(JSON.stringify({ ...msg, id }));
      const handler = (evt) => {
        const resp = JSON.parse(evt.data);
        if (resp.id === id) {
          this.ws.removeEventListener('message', handler);
          resolve(resp);
        }
      };
      this.ws.addEventListener('message', handler);
    });
  }
}
```

And in `auth.js`, the login flow:

```javascript
// src/auth.js — NIP-46 login path

export async function startLogin() {
  const challenge = await requestChallenge();
  if (!challenge.ok) return { ok: false, reason: challenge.reason };

  // Try NIP-46 first (built-in signer), fall back to NIP-07
  if (window.__continuumBunker) {
    try {
      const pubkey = await window.__continuumBunker.getPublicKey();
      const signed = await window.__continuumBunker.signEvent({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        content: challenge.data.challenge,
        tags: [['challenge', challenge.data.challenge]],
      });
      return verifyChallenge(signed);
    } catch (e) {
      console.warn('NIP-46 signer failed, falling back to NIP-07:', e);
    }
  }

  // Fall back to NIP-07 (browser extension)
  if (typeof window.nostr?.signEvent !== 'function') {
    return showSignerModal();
  }
  // ... existing NIP-07 flow
}
```

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| nsec on VPS | Already there in config.yaml. Encrypt at rest with Vault/age |
| WebSocket MITM | WSS-only (TLS). Validate Origin header |
| Unauthorized sign requests | Require session token or CORS origin check |
| Key rotation | Admin can update nsec in config + restart agent |
| Logging | Never log the nsec or signed events to agent logs |

---

## Related

- [NIP-46: Nostr Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md)
- [nsecbunker](https://github.com/kind0/nsecbunker) — Python NIP-46 bunker
- [nostr-sdk (Rust)](https://github.com/rust-nostr/nostr) — has NIP-46 client/server
- [NDK NIP-46 package](https://github.com/nostr-dev-kit/ndk/tree/main/packages/nip46) — TypeScript NIP-46 client
