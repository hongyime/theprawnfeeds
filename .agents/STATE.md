# Current State

Task: audit and upgrade `theprawnfeeds`, starting with security triage and Flask viability.

Progress:
- Read `AGENTS.md`; `.agents/` was absent at session start.
- Owner confirmed Vercel is the only real deployment and `theprawnfeeds.hong-yi.me` is canonical.
- Fixed initial `api/rss.js` SSRF risk by requiring `feedUrl` to match URLs derived from `feeds.json`, disabling redirects, and capping upstream XML response size.
- Verified Flask is not required by the primary Vercel reader: `/` and `/reader` serve `public/index.html`, client loads `/api/feeds` and `/api/rss`, and no `templates/` directory exists for `main.py`.
- Updated existing audit docs with Task 0 findings.
- Owner approved deleting Flask. Removed `main.py`, Python packaging, generated `public/feeds.js`, feed sync scripts/workflow, static Flask assets, and GitHub Pages workflows.
- Client now loads feed configuration only from `/api/feeds`; `vercel.json` now uses modern `functions`/`headers`/`rewrites` instead of legacy `builds`/`routes`.
- README, PRD, AUDIT, AUDIT_LOG, and security_audit now describe the Vercel-only Node/static runtime.
- Added Node tests for `/api/feeds` mapping and `/api/rss` allowlist/normalization behavior.
- Verification so far: Node syntax checks passed; `npm test` passed; `vercel dev` starts cleanly after setting `framework: null`; smoke-tested `/reader`, `/api/feeds`, a configured `/api/rss` feed, and an unconfigured SSRF probe.
- Updated existing CI workflow so PRs with JS/test/package changes install dependencies and run `npm test`.

Next steps:
- Run final status/diff check and commit the Flask removal.
