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
- Added `scripts/feeds.mjs` plus `npm run feeds:list`, `feeds:check`, and `feeds:smoke` to make feed updates and live checks easier.
- Live smoke found `eva` redirected from `https://kibty.town/blog.rss` to `https://eva.ac/blog.rss`; updated `feeds.json` to the final URL because `/api/rss` deliberately does not follow redirects.
- Live smoke found `Hackread` blocked direct RSS fetches with 403; switched to its working FeedBurner mirror. `Check Point Research` redirected to a trailing-slash feed URL; updated config. Reddit RSS returned 429 under concurrent smoke testing, so client concurrency was lowered from 20 to 6.
- `feeds:smoke` now samples across categories by default instead of only testing the first configured section.
- `/api/rss` now returns HTTP 429 for upstream feed rate limits so Reddit throttling is visible instead of appearing as a generic 500.
- `feeds:smoke -- --limit 10 --concurrency 2` passed with upstream warnings for Check Point Research and Reddit rate limiting; config validation passed for all 185 feeds.
- Production logs showed the old deployment crashed in `/api/rss` because `sanitize-html` required an ESM-only `htmlparser2`; removed `sanitize-html` from source and replaced it with local tag stripping/entity decoding for the next deployment.

Next steps:
- Run feed list/check/smoke commands and report current feed inventory.
