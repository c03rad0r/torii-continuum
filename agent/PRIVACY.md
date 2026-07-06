# Continuum Agent — Privacy invariants

Continuum treats sovereignty as a **construction constraint**, not a
marketing bullet. This file lists the invariants the agent daemon must
never violate.

## Non-negotiables

1. **No nsec on the VPS.** Ever. All signing happens in the operator's
   browser via Plebeian Signer / NIP-07. The agent verifies signatures;
   it never produces them.
2. **No autonomous writes to Nostr.** The agent may draft events, but
   publishing is always a human click, always signed in the browser.
   Draft skills (`nostr_draft`) return an event template; they do not
   emit a signed event.
3. **Gift-wrap-only writes.** When we do start publishing, the code
   paths for private data use NIP-17 exclusively. There is no
   "publish plaintext because it's simpler" fallback.
4. **Single-tenant.** One admin npub per agent. If multi-tenant becomes
   a goal, we build a separate daemon; we do not soften this invariant.
5. **No third-party analytics.** The agent does not ship logs to any
   provider. `audit.jsonl` and `costs.jsonl` live on your VPS; you own
   them.
6. **Cashu float, not custody.** The wallet holds a small operational
   float on the VPS. Losing the VPS should be inconvenient (a few
   thousand sats), not catastrophic.

## What the agent stores

| Path | Content | Mode |
| --- | --- | --- |
| `memory/wallet/<mint-slug>.json` | Cashu proofs for that mint | 0600 |
| `memory/costs.jsonl` | Per-request cost log (skill, model, sats, tokens, duration) | 0644 |
| `memory/audit.jsonl` | Auth challenge issuance/verification | 0644 |
| `memory/character/<eventid>.enc` | NIP-44 v2 ciphertext of the signed 30092 character_root | 0600 |
| `memory/semantic/<eventid>.enc` | NIP-44 v2 ciphertext of signed 30094 semantic_fact events | 0600 |
| `memory/intents/<eventid>.enc` | NIP-44 v2 ciphertext of signed 30096 destructive_intent events | 0600 |
| `memory/panic/<eventid>.enc` | NIP-44 v2 ciphertext of the signed 30097 emergency_wipe_authority (panic key) | 0600 |
| `memory/episodic/YYYY-MM-DD.jsonl` | Per-turn chat log for offline reflection. Plaintext. Never read at inference time. | 0600 |
| `memory/reflect-watermark.json` | Timestamp watermark so `/api/reflect` doesn't re-process turns | 0600 |
| `skills/<eventid>.enc` | NIP-44 v2 ciphertext of signed 30095 procedural_skill events | 0600 |
| `pending/*.draft.json` | UNSIGNED plaintext draft events waiting for browser signature | 0600 |
| `CHARACTER.md` | Plaintext identity document. Its SHA-256 is anchored in the signed 30092. | 0644 |
| `SOURCES.md` | Plaintext source lineage for CHARACTER.md. Anchored in the signed 30092. | 0644 |

Encrypted files (`.enc`) contain only NIP-44 v2 ciphertext addressed to
the operator's OWN npub. The agent has no key material to decrypt them.
Decryption happens exclusively in the operator's browser during
`POST /api/memory/unlock`. Plaintext then lives ONLY in the agent's RAM,
keyed by session token. On SIGINT / SIGTERM / explicit `/api/memory/lock`
/ panic wipe, the RAM cache is zeroed.

### Why plaintext CHARACTER.md and SOURCES.md?

The identity document is the public "who am I" contract. Its content is
not secret; its INTEGRITY is what matters. That integrity is enforced by
the 30092 character_root event, which anchors the SHA-256 of both files.
If disk is tampered with, the next unlock detects the mismatch and the
agent refuses to serve chat until the operator resolves it.

### Episodic is plaintext by design, walled off by rule

The episodic log (`memory/episodic/*.jsonl`) is plaintext because it is
never read at inference time. Only `/api/reflect` opens it — an offline
pass that proposes new 30094/30095 drafts for operator review. The
chat skill has no code path to open it during a live turn. If VPS disk
is seized cold, this log is the highest-value target; treat encrypted
full-disk (LUKS) as the standard mitigation.

## What the agent does not store

- Your nsec, encrypted or otherwise.
- Content of Nostr DMs you've read (the agent doesn't read them).
- Third-party API keys unless you put them in `config.yaml` (in which
  case they live only in `config.yaml`, mode 0600).
- **Any plaintext copy of your character stack, semantic facts, or
  procedural skills.** Those live on disk only as NIP-44 v2 ciphertext
  and in RAM only during an active unlocked session.

## What the agent sends over the network

- To Routstr: OpenAI-style chat payloads + one Cashu token per request,
  plus an `Authorization: Cashu <token>` header.
- To the operator's browser: chat replies, wallet balance, health.
- To Nostr relays: **nothing.** (Publishing is browser-side.)

## Panic wipe (optional)

The 30097 emergency_wipe_authority ("panic key") is **optional**. When
registered, its presence in the memory cache collapses the normal
60-second-cooldown + double-signature requirement for memory wipes to a
single signature — so the operator can wipe under duress from a single
device. Without one, wipes still work via the normal double-signature
flow. Setup runbook: `agent/PANIC_KEY_SETUP.md`.

## Related docs

- `agent/README.md` — VPS bring-up + HTTP API reference
- `agent/CHARACTER.md` — the identity document
- `agent/SOURCES.md` — source lineage
- `agent/PANIC_KEY_SETUP.md` — emergency wipe key generation
- Space wiki: `concepts/privacy-first-nostr.md` — gift-wrap invariants
- Space wiki: `entities/routstr.md` — model layer
- Space wiki: `projects/self-learning-continuum.md` — roadmap
