# Continuum ops

Everything you need to run Torii Continuum on your own VPS instead of on
`pplx.app`.

Contents:

- `ansible/` — full playbook that installs [torii-base](https://github.com/ChiefmonkeyArt/torii-base),
  Continuum (frontend + agent), and optionally Ollama.
- `nginx/continuum.conf.template` — annotated source for the nginx fragment
  the Ansible installer renders.

---

## Why a VPS?

The published `pplx.app` build of Continuum is static-only. It's great for
trying the UI, but three key pieces don't run in that sandbox:

- **Routstr chat** — needs a persistent Cashu float on-server.
- **Character memory** — encrypted at rest, decrypted at runtime.
- **Ollama local models** — needs a background daemon on the same host.

Running Continuum on a small VPS with `torii-base` gives you all three, on
a domain you control, sharing one nostr identity with the other Torii apps
mounted next to it (Plebeian, Quest).

---

## What the installer does

```
Ubuntu 22 / 24 host
├── torii-base
│   ├── nginx  (Let's Encrypt TLS)
│   ├── launcher at /
│   └── sidecar (127.0.0.1:8780)
├── continuum
│   ├── /continuum/ (static SPA, served from /home/continuum/app/dist)
│   ├── /continuum/api/ → 127.0.0.1:8787 (agent)
│   └── continuum-agent.service (systemd, hardened)
└── (optional) ollama
    └── 127.0.0.1:11434, models pulled per config
```

Everything runs as unprivileged users. The agent binds to loopback only —
external traffic never bypasses nginx.

---

## VPS sizing

Continuum agent alone is tiny (~100 MB RAM). Ollama is the dominant cost.

| Config                                        | RAM   | Disk  | vCPU | Rough £/mo (Hetzner) |
| --------------------------------------------- | ----- | ----- | ---- | -------------------- |
| Continuum + Quest, no Ollama                  | 2 GB  | 30 GB | 2    | £4–6                 |
| + Ollama 3B (llama3.2:3b)                     | 6 GB  | 50 GB | 2–3  | £8–10                |
| + Ollama 8B (llama3.1:8b) or 7B (qwen2.5:7b)  | 12 GB | 60 GB | 4    | £18–25               |
| + Ollama 14B (qwen2.5:14b, CPU-only)          | 16 GB | 80 GB | 4–6  | £30+                 |

Recommended starting point: **Hetzner CPX21** (3 vCPU, 8 GB, 80 GB) at
around £8/mo. Comfortably runs Continuum + Quest + Ollama 3B, with headroom
for one more small app.

Rough Ollama throughput on shared-CPU VPSes (Q4_K_M quant):

- 3B model: ~15 tok/s on 2 vCPU. Chat is fluid.
- 7B model: ~7 tok/s on 4 vCPU. Chat is tolerable, reflection is fine.
- 8B model: ~5 tok/s on 4 vCPU.
- 14B model: ~2 tok/s on 4 vCPU. Reflection only — don't use for chat.

For 8B+ chat on a live UI, get a GPU box (Hetzner GEX44 or a dedicated
Nvidia server); numbers above assume CPU-only.

---

## Quickstart (Ansible)

**On your workstation** (any OS with Ansible 2.14+):

```bash
git clone https://github.com/ChiefmonkeyArt/torii-continuum.git
cd torii-continuum/ops/ansible

cp inventory.yml.example inventory.yml
cp group_vars/all.yml.example group_vars/all.yml
cp group_vars/vault.yml.example group_vars/vault.yml

# Fill in inventory (your VPS IP/user), all.yml (your domain, models),
# and vault.yml (admin_npub, session_secret, cashu mints).

ansible-vault encrypt group_vars/vault.yml
ansible-playbook -i inventory.yml site.yml --ask-vault-pass
```

That's the whole installer. Re-running it is idempotent — the playbook is
safe to re-run to update Continuum, rotate config, or add Ollama later.

To enable Ollama on an existing deployment:

```bash
# edit group_vars/all.yml:  torii_enable_ollama: true
ansible-playbook -i inventory.yml site.yml --ask-vault-pass --tags ollama,continuum
```

---

## What lives where

```
/opt/torii/                              # torii-base state
  env                                    # admin token, domain
  registry.json                          # which apps are mounted where
  root_app.conf                          # nginx include for `/`
  launcher/                              # launcher static assets
  nginx-fragments/
    continuum.conf                       # dropped by the continuum role

/home/continuum/
  app/                                   # git checkout of torii-continuum
    dist/                                # vite build output (served by nginx)
    agent/
      config.yaml                        # rendered by ansible, chmod 600
      memory/
        wallet/                          # Cashu proofs (like cash — back it up)
        panic-key-nudge.json             # one-time console hint state
        costs.jsonl                      # per-request accounting (no PII)
        audit.jsonl                      # auth events (no PII)
      ciphertexts/                       # encrypted character/memory events
      pending/                           # draft nostr events awaiting your signature

/etc/systemd/system/
  torii-base-sidecar.service             # 127.0.0.1:8780 launcher API
  continuum-agent.service                # 127.0.0.1:8787 agent
  ollama.service.d/override.conf         # binds ollama to 127.0.0.1:11434 (optional)

/etc/nginx/sites-available/torii         # single server block; includes all fragments
```

---

## Backups

The two things you must back up:

1. `/home/continuum/app/agent/memory/wallet/` — the Cashu float. Losing
   this is losing sats.
2. `/home/continuum/app/agent/ciphertexts/` — encrypted character memory.
   Losing these means the agent forgets who you told it to be.

Everything else is regeneratable from the git repo + your nostr keys.
A weekly rsync of `/home/continuum/app/agent/{memory,ciphertexts}` to a
different host or backup service is plenty.

---

## Verifying the install

On the VPS:

```bash
sudo torii doctor
```

Should show all `ok`, with routstr and ollama either `ok` (if enabled) or
`warn` (if you skipped Ollama or Routstr is unreachable from your network).

From your laptop:

```bash
curl https://your-domain.com/                             # launcher (or your promoted app)
curl https://your-domain.com/continuum/                   # continuum SPA
curl https://your-domain.com/continuum/api/health          # agent
```

The last one returns `{"ok":true,"service":"torii-continuum-agent","version":"0.2.6-alpha",...}`.

Chat needs you to sign in via NIP-07 on the Console (`/continuum/`),
top up the Cashu wallet from your signer, and post a first message. See
`agent/README.md` for the full end-to-end walkthrough.

---

## Ollama fallback (CONT-AGENT-1b)

When `torii_enable_ollama: true`, the agent config gets:

```yaml
ollama:
  enabled: true
  endpoint: "http://127.0.0.1:11434"
  models:
    chat: "llama3.2:3b"
    reflect: "llama3.2:3b"

model_router:
  strategy: "routstr_first"
```

`routstr_first` (the recommended default) means:

1. Chat turns hit Routstr first — you get frontier models, paid in Cashu.
2. If Routstr returns 402 (float empty) or is unreachable, the agent
   falls back to Ollama automatically. Chat keeps working, offline and free.
3. When the wallet has sats again, the next turn goes back to Routstr.

Other strategies:

- `ollama_first` — Ollama first, Routstr as fallback. Cheap and slow by default.
- `ollama_only` — never call Routstr. Fully offline mode.
- `routstr_only` — never call Ollama. Original behaviour (pre-1b).

The Console's `/api/health/models` endpoint reports which providers are
enabled, reachable, and which models are loaded.

---

## License

MIT — matches Continuum.
