# Continuum — Installation Guide

Deploy Continuum on a VPS in under 5 minutes.

## Prerequisites

1. **A VPS** running Ubuntu 22.04+ or Debian 12+ with SSH access
2. **A domain** pointed at your VPS (two subdomains: `continuum.yourdomain` + `agent.yourdomain`)
3. **Ansible 2.x** on your local machine (`pip install ansible-core` or `apt install ansible`)
4. **Plebeian Signer** (or any NIP-07 browser extension) installed in your browser
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/plebeian-signer/
   - Chrome: https://chromewebstore.google.com/detail/ijbiankmnehjephbkfdgphckcdgbgoho
5. **Your npub** — copy it from Plebeian Signer → Settings → Copy Public Key

## One-Command Install

```bash
git clone https://github.com/ChiefmonkeyArt/torii-continuum.git
cd torii-continuum

# Set your variables
export CONTINUUM_VPS_IP="1.2.3.4"
export CONTINUUM_VPS_USER="root"
export CONTINUUM_ADMIN_NPUB="npub1..."          # from Plebeian Signer
export BASE_DOMAIN="yourdomain.com"
export CONTINUUM_DOMAIN="continuum.yourdomain.com"
export CONTINUUM_AGENT_DOMAIN="agent.yourdomain.com"
export ACME_EMAIL="admin@yourdomain.com"

# Optional: Cloudflare DNS automation (skip to manage DNS manually)
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."

# Deploy
ansible-playbook ansible/playbooks/deploy.yml -i ansible/inventory/hosts.yml
```

## What the Installer Does

1. **system** — Creates a `continuum` system user, ensures Node.js 20 LTS is installed
2. **identity** — Validates your npub, generates a session secret. No nsec on the VPS.
3. **continuum_agent** — Clones the repo, installs dependencies, renders `config.yaml`, builds the frontend, starts the systemd service
4. **caddy** — Detects existing Caddy (or installs fresh), injects reverse proxy routes, provisions TLS certificates

## Post-Install

1. **Verify the agent**: `curl https://agent.yourdomain.com/api/health`
   Should return: `{"ok":true,"service":"torii-continuum-agent",...}`
2. **Open the frontend**: Visit `https://continuum.yourdomain.com`
3. **Login**: Click "Login with Nostr" — Plebeian Signer will prompt you to sign a challenge
4. **Top up the wallet**: Get testnut tokens from https://faucet.cashu.email/ and paste them in the Routstr tab

## How Auth Works

The instance is locked to the npub you provided at install time. Only that key can log in via Plebeian Signer. No nsec (private key) ever touches the server — signing happens entirely in your browser.

To change the admin:
```bash
ssh user@your-vps
sudo -u continuum vi /home/continuum/agent/repo/agent/config.yaml
# Change admin_npub to the new npub
sudo systemctl restart continuum-agent
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `CONTINUUM_ADMIN_NPUB is required` | Export your npub before running ansible |
| Agent won't start | Check config.yaml: `journalctl -u continuum-agent -f` |
| Frontend shows "demo mode" | Caddy isn't proxying the agent. Check Caddy routes. |
| 403 on frontend | Caddy can't read dist/. Run: `chmod 755 /home/continuum /home/continuum/agent /home/continuum/agent/frontend` |
| Login fails "no NIP-07 signer" | Install Plebeian Signer browser extension |
| TLS not provisioning | Ensure DNS A records point at VPS and port 80 is open |

## What's NOT on the VPS

- Your nsec (private key) — stays in Plebeian Signer, never sent to server
- Your Cashu proofs — wait, actually those ARE on the VPS in `memory/wallet/`. Back them up.
- Any account or email — there is no account system. Your npub IS your identity.
