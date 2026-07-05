# Continuum Agent — VPS bring-up

The Continuum agent is a small Fastify daemon that owns three invariants
for a single operator:

1. **NIP-07 login** — verifies challenge events signed in the operator's
   browser via Plebeian Signer. No nsec ever reaches the VPS.
2. **Cashu wallet** — holds a small float in `memory/wallet/` (mode 0600)
   using [`@cashu/cashu-ts`](https://github.com/cashubtc/cashu-ts).
3. **Routstr chat** — OpenAI-compatible client, DeepSeek-Chat by default,
   DeepSeek-Coder-V2 for the `code` skill, fallback ladder configurable,
   pays one Cashu token per request.

Everything is designed for **one admin npub, one VPS**. Multi-tenant is
explicitly not a promise.

---

## 0. Prerequisites

- Ubuntu 22.04 LTS (or any distro with systemd)
- Node 20 LTS (`nvm install 20 && nvm alias default 20`)
- Domain pointed at your VPS (e.g. `agent.yourdomain.tld`)
- Plebeian Signer installed in your browser (or any NIP-07 signer)
- A Cashu wallet you control with a small float (~5,000 sats to start)

## 1. Create a dedicated user

```bash
sudo adduser --system --group --home /home/continuum continuum
sudo -u continuum -H bash -c 'mkdir -p ~/agent && chmod 700 ~'
```

## 2. Clone + install

```bash
sudo -u continuum -H bash <<'EOF'
cd ~/agent
git clone https://github.com/ChiefmonkeyArt/torii-continuum.git repo
cd repo/agent
npm install --omit=dev
EOF
```

## 3. Configure

```bash
sudo -u continuum -H bash <<'EOF'
cd ~/agent/repo/agent
cp config.example.yaml config.yaml
chmod 600 config.yaml
EOF
```

Then edit `config.yaml`:

- `auth.admin_npub` — **your own npub1…** (decoded to hex at boot; fail-fast if invalid)
- `auth.session_secret` — 64 hex chars, generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `server.cors_origins` — add `https://continuum-torii.pplx.app` and any
  self-hosted origin you use
- `cashu.mints` — the mints you trust. Anything not in this list is
  **rejected** by `POST /api/wallet/receive`.
- `routstr.api_key` — your Routstr key if the endpoint requires one;
  leave blank for the public Cashu-paid path

## 4. systemd unit

```bash
sudo tee /etc/systemd/system/continuum-agent.service >/dev/null <<'EOF'
[Unit]
Description=Continuum Agent (Fastify)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=continuum
Group=continuum
WorkingDirectory=/home/continuum/agent/repo/agent
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/home/continuum/agent/repo/agent
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now continuum-agent
sudo systemctl status continuum-agent --no-pager
```

Health check:

```bash
curl -s http://127.0.0.1:8787/api/health | jq
```

## 5. nginx + Let's Encrypt

```nginx
# /etc/nginx/sites-available/agent.yourdomain.tld
server {
  server_name agent.yourdomain.tld;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 512k;
  }

  listen 80;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/agent.yourdomain.tld /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d agent.yourdomain.tld
```

## 6. Point the frontend at your agent

Set a build-time env var when building `torii-continuum`:

```bash
VITE_AGENT_URL=https://agent.yourdomain.tld npm run build
```

or drop this into `window` at runtime (e.g. via a small `agent-config.js`
served alongside the site):

```html
<script>window.__CONTINUUM_AGENT_URL__ = 'https://agent.yourdomain.tld';</script>
```

The demo build at `continuum-torii.pplx.app` intentionally omits
`VITE_AGENT_URL` so it stays in offline/mock mode.

## 7. Top up the wallet

1. Open your Cashu wallet, mint or receive a small amount (e.g. 5,000 sats).
2. Emit an encoded token (`cashuAeyJ0b2tlbi…`) from a whitelisted mint.
3. Open your Continuum site → **Routstr** → **Connect Cashu wallet** →
   paste the token → **Redeem to agent**.
4. Balance shows in the header. Requests debit from it in real time.
5. Watch `~/agent/repo/agent/memory/costs.jsonl` for a per-request cost log.

## 8. Rotating things

- **Session secret**: change `auth.session_secret` and restart. All
  existing session tokens are invalidated immediately.
- **Admin npub**: change `auth.admin_npub` and restart.
- **Wallet**: proofs live in `memory/wallet/<mint-slug>.json`. Back them
  up (mode 0600); losing this file loses the sats.

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `admin_npub invalid` on boot | Check the npub decodes cleanly (`npub1…`, 63 chars) |
| `session_secret too short` | Must be exactly 64 hex chars |
| Frontend "Login" says demo mode | `VITE_AGENT_URL` not set at build time, or `window.__CONTINUUM_AGENT_URL__` not injected |
| 403 from Plebeian Signer | Check you signed with the admin npub, not a secondary key |
| `mint not whitelisted` on redeem | Add the mint URL to `cashu.mints` and restart |
| Balance not updating | Check `memory/wallet/` permissions (should be `700`), then `systemctl restart continuum-agent` |

## 10. Uninstall

```bash
sudo systemctl disable --now continuum-agent
sudo rm /etc/systemd/system/continuum-agent.service
sudo rm /etc/nginx/sites-enabled/agent.yourdomain.tld
sudo systemctl reload nginx
sudo deluser --remove-home continuum
```
