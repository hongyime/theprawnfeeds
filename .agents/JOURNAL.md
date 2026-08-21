# Journal

- 2026-08-21: Owner confirmed Vercel is the only intended deployment and `theprawnfeeds.hong-yi.me` is the canonical domain; requested investigation before deciding whether Flask is needed.
- 2026-08-21: Security triage found `/api/rss` accepted caller-supplied URLs; fixed by allowing only URLs derived from `feeds.json`, disabling redirects, and capping XML response size.
- 2026-08-21: Flask appears unnecessary for the intended Vercel deployment because the primary reader is static plus Node APIs and `main.py` has no template directory for its server-rendered route.
