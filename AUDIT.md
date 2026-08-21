# AUDIT.md — theprawnfeeds

Generated: 20260524
Updated: 20260821

## 0. FILESYSTEM HEALTH REPORT
No corrupted, orphaned, or sync artifact files detected.

## 1. MASTER FEATURE MAP
| File | Purpose | Key Functions |
|------|---------|---------------|
| api\feeds.js | Maps canonical `feeds.json` into client feed categories | `loadFeeds`, `mapFeedsConfig` |
| api\rss.js | Fetches and parses allowlisted RSS/Atom feeds | `validateFeedUrl`, `fetchFeed`, `parseRss2`, `parseAtom` |
| public\app.js | Browser reader, lazy loading, modal, offline feed UI | `loadFeedsConfig`, `fetchFeed`, `setupSections`, `renderSectionView` |
| public\index.html | Static reader shell | N/A |
| public\404.html | Static not-found page | N/A |
| public\styles.css | Reader styles | N/A |

## 2. RECONCILIATION SUMMARY
The app is now Vercel static assets plus Node API functions. The previous Flask path, generated `public/feeds.js`, sync scripts, and GitHub Pages workflows were removed after verification that the primary reader does not depend on them.

## 3-5. GAPS / GHOSTS / DRIFT
- Historical docs claimed GitHub Pages and Flask support; corrected to Vercel-only Node runtime.
- `last_sync.txt` was committed at the repo root; moved to `.agents/last_sync.txt`.

## 6. DATA INTEGRITY
N/A — no databases.

## 7. CODE QUALITY FINDINGS
| Tag | Description | Severity |
|-----|-------------|----------|
| [DEAD] | Flask runtime and generated feed-sync path were dead for the Vercel reader | Fixed |
| [SECURITY] | `/api/rss` accepted caller-supplied URLs before allowlist validation | Fixed |

## 8. STRUCTURAL REORGANIZATION
Structure simplified to one runtime and one feed config source.

## 9. PRODUCTION READINESS
Production readiness improved with Vercel security headers, explicit Node runtime, and no Python catch-all cold starts.

## 10. REMEDIATION ROADMAP
- Add scheduled feed snapshot generation to stop fetching third-party feeds on every page load.
- Add broader parser fixtures for malformed RSS/Atom entries.
