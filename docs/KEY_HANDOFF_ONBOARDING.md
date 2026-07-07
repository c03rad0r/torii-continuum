# Key Handoff Onboarding — Design Plan

**Date:** 2026-07-07
**Status:** Proposal — awaiting decision
**Author:** c03rad0r

---

## The Goal

VPS generates entropy (nsec) at deploy time. On first login, the VPS hands the key to the user's browser. The user imports it into their signer. The VPS validates the user can sign with it. Then the VPS **deletes the nsec permanently** — keeps only the npub. The user is now self-sovereign.

```
Deploy        First Login         Validation        Steady State
──────        ───────────         ──────────        ────────────
VPS gen       VPS ──nsec──►       User signs        VPS: npub only
nsec          browser             challenge         User: owns nsec
              User imports        VPS verifies      in browser signer
              into signer         ✓ → DELETE nsec
```

---

## The Hard Problem: NIP-07 Has No Import API

This is the single biggest constraint. **NIP-07 browser signers (nos2x-fox, nos2x, Alby, Plebeian Signer) do NOT support programmatic key import.** The NIP-07 spec defines only:

- `window.nostr.getPublicKey()` — read-only
- `window.nostr.signEvent(event)` — sign-only
- `window.nostr.getRelays()` — read-only

There is **no** `window.nostr.importKey(nsec)` or `window.nostr.setKey(nsec)`. You cannot inject a key into an extension from a web page. This is by design — it would be a massive security hole (any website could overwrite your key).

### What this means

The "handoff" cannot be fully automatic. The user **must** manually paste the nsec into their extension's settings UI. There is no way around this with NIP-07.

---

## Three Onboarding Paths

### Path A: NIP-07 Extension Import (Manual but secure)

```
1. User opens Continuum → "Set up your admin key"
2. VPS serves nsec to frontend (one-time, authenticated session)
3. Frontend shows: "Your admin key: nsec1... [Copy] [Show QR]"
   + Instructions: "Open nos2x-fox → Settings → Import Key → Paste"
4. User manually imports into extension
5. User clicks "Validate" in Continuum
6. Frontend calls window.nostr.signEvent(challenge)
7. VPS verifies signature matches npub → DELETES nsec from config
8. Done — user owns key in extension, VPS has npub only
```

**Friction:** Medium. User must install extension + manually paste key.
**Security:** High — key lives in extension's secure storage.
**Key loss:** User must back up extension key independently.

### Path B: Browser-Managed Key (No extension needed)

```
1. User opens Continuum → "Set up your admin key"
2. VPS serves nsec to frontend (one-time, authenticated session)
3. Frontend stores nsec in browser (IndexedDB, encrypted with passphrase)
4. Frontend implements its own NIP-07 shim:
   window.nostr = {
     getPublicKey: () => storedPubkey,
     signEvent: (e) => signWithStoredKey(e),
   }
5. User signs challenge → VPS verifies → DELETES nsec
6. Done — key lives in browser, no extension needed
```

**Friction:** Low. No extension install. Just set a passphrase.
**Security:** Medium — XSS can steal key from browser memory. Browser data clearing = key loss.
**Key loss:** User must export key to back it up (show nsec, write down).

This is the model used by **Snort, Iris, Coracle, Primal** — most popular Nostr web apps. Users paste nsec directly. It works, it's common, but it's less secure than extension storage.

### Path C: Hybrid — Browser first, extension later

```
1. Same as Path B (browser-managed key for instant onboarding)
2. After login, Continuum shows: "For better security, move your key to a signer extension"
3. Frontend offers: "Export key to nos2x-fox" → shows nsec + import instructions
4. User imports into extension
5. Frontend deletes key from browser storage
6. Future logins use extension (NIP-07)
```

**Friction:** Lowest at first login, optional upgrade later.
**Security:** Starts medium (browser), upgrades to high (extension).
**Key loss:** Same as Path B until user migrates.

---

## Tradeoff Matrix

| Factor | Path A (Extension) | Path B (Browser) | Path C (Hybrid) |
|--------|-------------------|------------------|-----------------|
| First-login friction | High (install + paste) | Low (passphrase) | Low (passphrase) |
| Extension required | Yes | No | No (optional) |
| Key security | High (extension sandbox) | Medium (XSS risk) | Medium → High |
| Key backup burden | User must export | User must export | User must export |
| Implementation effort | Low (just UI) | Medium (key mgmt + crypto) | High (both paths) |
| Nostr ecosystem norm | Less common | Most common | Novel |
| VPS can delete nsec | Yes | Yes | Yes |
| Multi-device | Each browser needs key | Each browser needs key | Each browser needs key |

---

## Security Analysis: The Handoff Window

### The Vulnerable Window

```
Deploy ──────────────────────────── Handoff Complete
         ↑                              ↑
         nsec on VPS (disk + memory)    nsec deleted

         ←── This window is the risk ──→
```

During the window between deploy and handoff:

1. **Config file on disk** (`config.yaml`) contains nsec in plaintext
2. **Agent process memory** holds the nsec
3. **Any backups** or snapshots contain the nsec
4. **VPS root compromise** = full key theft

**Mitigations:**
- Encrypt config at rest (age / Vault)
- Minimize window — force handoff on first login, refuse to serve until complete
- Zeroize memory after serving the key
- Document that backups made before handoff must be destroyed

### The Handoff Transaction

The critical moment — nsec travels from VPS to browser:

```
VPS ──HTTPS──► Browser memory ──► Extension storage / IndexedDB
                    ↑
              TLS protects transit
              But: devtools, extensions, XSS can see it
```

**Risk:** During handoff, the nsec is in browser memory as a JS string. Any running extension or XSS payload can grab it.

**Mitigations:**
- Serve nsec only to a dedicated `/onboarding` route
- Zero the JS string after use (`key.fill(0)` — though JS strings are immutable, use Uint8Array)
- CSP headers to prevent XSS on the onboarding page
- Rate-limit the endpoint to one fetch per session
- Delete from VPS immediately after successful validation

### Post-Handoff

After VPS deletes the nsec:

- **VPS compromise** no longer reveals the key ✓
- **Key is user's responsibility** — they must back it up
- **VPS cannot help with key recovery** — only npub remains
- **Admin key rotation** requires a new deploy or a key-reset flow

---

## Recommended Architecture

### Path C (Hybrid) — Recommended

**Phase 1: Browser-managed key for instant onboarding**
- Zero friction — user just picks a passphrase
- Key is stored encrypted in IndexedDB
- Frontend implements NIP-07 shim over the stored key
- Works immediately, no extension install

**Phase 2: Optional extension migration**
- After login, Continuum nudge: "Secure your key"
- Show nsec + extension import instructions
- User migrates → frontend clears browser storage
- From then on, extension handles signing

### Why Hybrid

1. **Lowest friction at first login** — the #1 UX complaint
2. **Security upgrade path** — not locked into browser-only
3. **Follows Nostr ecosystem norms** — browser nsec is standard (Snort, Iris)
4. **VPS deletes key** — self-sovereignty achieved
5. **No new protocol needed** — just frontend code + one agent endpoint

---

## Implementation Plan

### Agent Changes (Go)

#### 1. New endpoint: `GET /api/onboarding/key` (authenticated, one-time)

```go
// Returns the nsec IF it hasn't been handed off yet.
// After successful validation, the nsec is deleted from config.
// Subsequent calls return 410 Gone.

func handleOnboardingKey(w http.ResponseWriter, r *http.Request) {
    // 1. Require valid session (admin must be authenticated somehow first)
    //    — see "bootstrap auth" below
    // 2. Check if key already handed off (config flag)
    if config.KeyHandedOff {
        http.Error(w, "Key already handed off", 410)
        return
    }
    // 3. Return nsec
    json.NewEncoder(w).Encode(map[string]string{
        "nsec": config.AdminNsec,
        "npub": config.AdminNpub,
    })
}
```

#### 2. New endpoint: `POST /api/onboarding/confirm` (one-time)

```go
// Validates that the user can sign with the key.
// On success: deletes nsec from config, sets handed_off=true.
func handleOnboardingConfirm(w http.ResponseWriter, r *http.Request) {
    var body struct {
        SignedEvent nostr.Event `json:"event"`
    }
    json.NewDecoder(r.Body).Decode(&body)

    // 1. Verify signature is valid
    ok, _ := body.SignedEvent.CheckSignature()
    if !ok {
        http.Error(w, "Invalid signature", 400)
        return
    }
    // 2. Verify pubkey matches admin npub
    if body.SignedEvent.PubKey != config.AdminNpubHex {
        http.Error(w, "Wrong pubkey", 400)
        return
    }
    // 3. Verify it's a recent auth challenge (kind 22242)
    if body.SignedEvent.Kind != 22242 {
        http.Error(w, "Wrong event kind", 400)
        return
    }
    // 4. SCRUB nsec from config
    config.AdminNsec = ""
    config.KeyHandedOff = true
    config.Save()
    // 5. Zeroize any in-memory copies
    // ...

    w.WriteHeader(200)
}
```

#### 3. Config changes

```yaml
# config.yaml
admin_nsec: "nsec1..."        # Present at deploy, deleted after handoff
admin_npub: "npub1..."         # Always present
key_handed_off: false          # Set true after successful handoff
```

### Frontend Changes (JS)

#### 1. Onboarding flow in `auth.js`

```javascript
// src/auth.js — new onboarding path

export async function checkOnboardingNeeded() {
  // Check if VPS still has the nsec (not yet handed off)
  const resp = await fetch(`${AGENT_URL}/api/onboarding/status`);
  const data = await resp.json();
  return data.needs_handoff;
}

export async function startOnboarding() {
  // Step 1: Fetch nsec from VPS (one-time)
  const keyResp = await fetch(`${AGENT_URL}/api/onboarding/key`, {
    credentials: 'include',
  });
  if (!keyResp.ok) throw new Error('Key not available');
  const { nsec, npub } = await keyResp.json();

  // Step 2: Store in browser (encrypted IndexedDB)
  const passphrase = await promptPassphrase();
  await storeKeyEncrypted(nsec, passphrase);

  // Step 3: Install NIP-07 shim
  installNip07Shim();

  // Step 4: Validate — sign challenge
  const challenge = await requestChallenge();
  const signed = await window.nostr.signEvent({
    kind: 22242,
    content: challenge.data.challenge,
    tags: [['challenge', challenge.data.challenge]],
    created_at: Math.floor(Date.now() / 1000),
  });

  // Step 5: Confirm with VPS → triggers nsec deletion
  await fetch(`${AGENT_URL}/api/onboarding/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: signed }),
  });

  // Step 6: Key is now user's. VPS has npub only.
  return { success: true };
}
```

#### 2. Browser key storage (encrypted)

```javascript
// src/lib/keyVault.js

const DB_NAME = 'continuum-keyvault';
const STORE = 'keys';

async function storeKeyEncrypted(nsec, passphrase) {
  // Derive key from passphrase
  const encKey = await deriveKey(passphrase);
  // Encrypt nsec
  const encrypted = await encrypt(nsec, encKey);
  // Store in IndexedDB
  const db = await openDB();
  await db.put(STORE, { id: 'admin', data: encrypted });
}

async function loadKey(passphrase) {
  const db = await openDB();
  const { data } = await db.get(STORE, 'admin');
  const encKey = await deriveKey(passphrase);
  return decrypt(data, encKey);
}
```

#### 3. NIP-07 shim for browser-managed signing

```javascript
// src/lib/nip07Shim.js

export function installNip07Shim() {
  if (window.nostr) return; // Extension already present, don't override

  window.nostr = {
    async getPublicKey() {
      const nsec = await loadKeyFromVault();
      return getPubkeyFromNsec(nsec);
    },
    async signEvent(event) {
      const nsec = await loadKeyFromVault();
      return signEventWithNsec(event, nsec);
    },
    async getRelays() {
      return {};
    },
  };
}
```

#### 4. Extension migration UI (Phase 2)

```javascript
// After successful onboarding, show optional migration prompt

export function showExtensionMigrationPrompt() {
  // "For better security, move your key to nos2x-fox"
  // [Show nsec] [Copy] [I've imported it] → clear browser storage
}
```

### Bootstrap Auth Problem

**The chicken-and-egg:** To serve the nsec securely, the agent needs to know the request is from a legitimate admin. But the admin hasn't proven their identity yet (that's the whole point).

**Solutions:**

1. **Deploy-time token** — Ansible generates a one-time bootstrap token, writes to a file only root can read. First login requires this token. After handoff, token is destroyed.

2. **First-request-wins** — First person to hit `/api/onboarding/key` with the correct deploy secret gets the key. Config flag prevents repeat access.

3. **Physical/secure channel** — Ansible prints the bootstrap URL to terminal (SSH session). Admin clicks it from their SSH session.

**Recommended:** Option 1 — deploy-time bootstrap token. The token is in the Ansible output, admin pastes it into the onboarding screen.

```
Deploy output:
┌─────────────────────────────────────────────┐
│ Continuum deployed successfully!             │
│                                              │
│ Your one-time onboarding URL:                │
│ https://continuum.example.com/#/onboarding   │
│ Bootstrap token: aB3xF9kL2mN7pQ              │
│                                              │
│ This token will be deleted after first use.  │
└─────────────────────────────────────────────┘
```

---

## Edge Cases

### Key loss after handoff

**Problem:** User clears browser data, loses extension key. VPS only has npub — can't recover.
**Mitigation:** During onboarding, show warning: "Back up your key. If you lose it, you'll need to redeploy." Offer "Export key" button that shows the nsec one more time (from browser storage, before VPS deletion).

### Multiple admins

**Problem:** What if two people need admin access?
**Solution:** The handoff flow generates ONE key for ONE admin. For multi-admin:
- Option A: Each admin generates their own key, adds npub to config manually
- Option B: Admin who completed handoff can invite others via a `/api/admin/invite` endpoint

### VPS re-image / migration

**Problem:** VPS dies after handoff. New VPS deployed. Does it generate a new key?
**Solution:** Ansible should accept an optional `CONTINUUM_EXISTING_NPUB` env var. If set, skip key generation — just configure the existing npub. User logs in with their existing key.

### Key rotation

**Problem:** User wants to rotate their key after compromise.
**Solution:** Generate new nsec → re-run handoff flow → old npub removed from config. Requires a "reset key" admin endpoint that needs current key auth.

### Handoff fails midway

**Problem:** User fetches nsec but doesn't complete validation. VPS still has key.
**Solution:** The nsec stays on VPS until validation succeeds. User can retry. No security degradation — VPS had the key all along. The `/api/onboarding/key` endpoint can be hit multiple times until validation succeeds.

---

## Effort Estimates

| Component | Effort | Dependencies |
|-----------|--------|--------------|
| Agent: `/api/onboarding/key` + `/api/onboarding/confirm` | 4h | None |
| Agent: config nsec deletion + zeroize | 2h | None |
| Agent: bootstrap token generation | 2h | Ansible changes |
| Frontend: onboarding flow UI | 6h | Agent endpoints |
| Frontend: encrypted IndexedDB key vault | 4h | Web Crypto API |
| Frontend: NIP-07 shim (browser signing) | 3h | nostr-tools or @noble/secp256k1 |
| Frontend: extension migration prompt | 3h | None |
| Ansible: bootstrap token + deploy output | 2h | None |
| Tests: handoff flow, deletion, retry, multi-admin | 6h | All above |
| **Total** | **~32h (4 days)** | |

---

## Comparison to Alternatives

| Approach | VPS has nsec? | User friction | Key security | Implementation |
|----------|--------------|---------------|-------------|----------------|
| **This plan (hybrid handoff)** | Temporarily → deleted | Low | Medium → High | 4 days |
| NIP-46 bunker (permanent) | Always | Lowest | Low (VPS compromise = key theft) | 2 weeks |
| Extension-only (current) | Never | High | High | Done |
| Direct nsec paste (user generates) | Never | Medium | Medium | 1 day |

### Why this plan over NIP-46 bunker

The NIP-46 bunker keeps the nsec on the VPS permanently. Every sign request goes to the VPS. The VPS is a permanent honeypot. Our plan deletes the key after handoff — the VPS becomes useless to attackers after onboarding.

### Why this plan over "user generates their own key"

User-generated keys require the user to understand nsec, npub, install a signer, generate a key, and configure it. That's the exact UX problem we're solving. This plan generates the key FOR them and walks them through claiming it.

---

## Open Questions

1. **Should the key vault use a passphrase or be passphraseless?** Passphrase adds friction but protects against XSS key theft. Snort is passphraseless (stores raw nsec in localStorage). Iris uses a passphrase. Recommendation: passphrase, but remember it in sessionStorage for the session.

2. **Should we support hardware signers (Amber, NIP-46)?** Yes, as a Phase 3 — once the key is in the browser, the user can migrate to Amber for phone-based signing. The handoff flow doesn't need to change.

3. **Should the bootstrap token be URL-embedded or separate?** URL-embedded (`/#/onboarding?token=abc`) is easier UX but token ends up in browser history / referrer headers. Separate paste field is safer. Recommendation: separate field.

4. **Should we notify the user when VPS deletes the key?** Yes — show a confirmation: "Your key has been transferred. The server no longer holds a copy. You are now the sole owner of this key."

---

## Decision Needed

Which path do you want?

- **Path A (Extension import only)** — simplest, 1-2 days, but requires extension
- **Path B (Browser-managed key only)** — no extension, 2-3 days, medium security
- **Path C (Hybrid — browser now, extension later)** — best UX, 4 days, recommended
