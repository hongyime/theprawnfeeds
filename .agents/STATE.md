# Current State

Task: audit and upgrade `theprawnfeeds`, starting with security triage and Flask viability.

Progress:
- Read `AGENTS.md`; `.agents/` was absent at session start.
- Owner confirmed Vercel is the only real deployment and `theprawnfeeds.hong-yi.me` is canonical.
- Fixed initial `api/rss.js` SSRF risk by requiring `feedUrl` to match URLs derived from `feeds.json`, disabling redirects, and capping upstream XML response size.
- Verified Flask is not required by the primary Vercel reader: `/` and `/reader` serve `public/index.html`, client loads `/api/feeds` and `/api/rss`, and no `templates/` directory exists for `main.py`.
- Updated existing audit docs with Task 0 findings.

Next steps:
- Get owner approval before deleting Flask files/routes and related sync tooling.
- If Flask is deleted, migrate `vercel.json`, remove `public/feeds.js` fallback/sync workflow, and update README/PRD.
