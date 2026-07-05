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
| `pending/*.json` | Draft events waiting for a browser signature | 0600 |

## What the agent does not store

- Your nsec, encrypted or otherwise.
- Content of Nostr DMs you've read (the agent doesn't read them).
- Third-party API keys unless you put them in `config.yaml` (in which
  case they live only in `config.yaml`, mode 0600).

## What the agent sends over the network

- To Routstr: OpenAI-style chat payloads + one Cashu token per request,
  plus an `Authorization: Cashu <token>` header.
- To the operator's browser: chat replies, wallet balance, health.
- To Nostr relays: **nothing.** (Publishing is browser-side.)

## Related docs

- `agent/README.md` — VPS bring-up
- Space wiki: `concepts/privacy-first-nostr.md` — gift-wrap invariants
- Space wiki: `entities/routstr.md` — model layer
- Space wiki: `projects/self-learning-continuum.md` — roadmap
