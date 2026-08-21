# AUDIT_LOG.md

## Reconnaissance - 20260524

### REPO_CONTEXT

| Field | Value |
|-------|-------|
| Project Name | theprawnfeeds |
| Language(s) | JavaScript/TypeScript |
| Framework(s) | Node.js |
| Core Purpose | A modern, mobile-responsive RSS reader webapp with Glance-inspired neutral UI |
| Test Runner | none detected |
| Dependency File | package.json (2 deps + 1 devDeps) |
| Rough Complexity | Small (4 source files) |
| Existing Snyk Results | NONE |
| Snyk Scan Needed | NO (Dependabot configured for ongoing monitoring) |

### Phase 1 - Security Audit

SCA: 2 production + 1 dev dependencies. Most post-date internal knowledge cutoff.
SAST: 0 potential secret patterns detected.
Snyk: NOT TRIGGERED (Dependabot provides equivalent coverage)
Status: SAFE (SCA deferred to Dependabot)

## Security Triage - 20260821

### Task 0 Findings

| Area | Finding | Status |
|------|---------|--------|
| `api/rss.js` URL input | Public `/api/rss` accepted caller-supplied `feedUrl`; it parsed XML into JSON and did not mirror upstream headers/body verbatim, but it was not constrained to configured feeds. | Fixed: exact allowlist derived from `feeds.json`, redirects disabled, XML response size capped. |
| `api/feeds.js` URL input | Does not accept caller-supplied URLs; it reads `feeds.json` and maps known feed URLs. | No direct SSRF issue found. |
| Flask path | `main.py` was only reached by legacy `/flask` and catch-all Vercel routes; the primary app routes `/` and `/reader` to `public/index.html` and uses Node APIs. No `templates/` directory existed for `render_template('index.html')`. | Deleted after owner approval. |

### Runtime Simplification - 20260821

Removed Flask, Python packaging, generated `public/feeds.js`, feed-sync scripts/workflow, old static Flask assets, and GitHub Pages workflows. The app is now Vercel static assets plus Node API functions with `feeds.json` as the single feed config source.
