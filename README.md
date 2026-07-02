# Continuum

An app builder, project engine and marketplace for bot work — a gateway into the Torii ecosystem.

Continuum treats every project like a nostr identity: portable, signable, yours. Projects, sessions, milestones, todos, and files are all shaped as nostr events (addressable kinds 30078–30082). MVP stores them in `localStorage`; the same objects flip to signed relay events without re-shaping.

## What's here (v0.1)

- **Projects** — list, create, open. Import from GitHub or ngit. Cascades to sessions/milestones/todos/files.
- **Project home** — milestones ladder, session log, live todo list, files created.
- **Marketplace** — open AI-work tasks. Yours highlighted amber.
- **Routstr** — connect a Cashu wallet (mock), pick your model (default DeepSeek Chat), monitor usage.
- **Dashboard** — cross-project oversight rundown.
- **AI chat dock** — docked at the bottom of every page, context-aware. Mocked replies until Routstr is wired.

## Data shape (draft, not a NIP)

| Kind    | Purpose                          | `d` tag                    |
| ------- | -------------------------------- | -------------------------- |
| 30078   | Project                          | `<slug>`                   |
| 30079   | Session                          | `<slug>:<session-id>`      |
| 30080   | Milestone                        | `<slug>:m<index>`          |
| 30081   | Todo                             | `<slug>:<todo-id>`         |
| 30082   | File reference                   | `<slug>:<path>`            |
| 30090   | Marketplace task listing         | task id                    |
| 30091   | Routstr wallet + prefs           | `default`                  |

## Dev

```bash
npm install
npm run dev       # http://127.0.0.1:5180
npm run build     # → dist/
npm run preview   # serve dist/
```

## Roadmap

- M1 ✅ App shell + navigation
- M2  Projects + project home
- M3  Routstr + marketplace shells
- M4  NIP-07 signer, publish events
- M5  Own relay + sync

## Related

- [Torii Quest](https://torii-quest.pplx.app) — the open-world arena shooter and Continuum's first surface.
