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

## 2026-09-10: confirmed request amplification and deadlines

Expected: opening a category should fetch that category, and upstream work must
finish within the configured 30-second Vercel duration. Existing data and the
185-feed catalog must remain intact.

Synthetic probes against unchanged source confirmed that `startLazyLoadFeeds`
queues all 185 sources, including 154 outside the initial Blogs category. Its
shuffle also undoes the attempted visible-category prioritization. A transport
probe found zero active timers while an RSS body was still pending: both fetch
loops clear their timeout after headers. Two simultaneous identical requests
made two upstream calls. An invalid Unicode entity threw `RangeError`.
The original three Node tests pass but do not cover these cases. These probes
made no real provider requests. Root causes are the all-category queue,
header-only deadlines, a completed-results-only cache, and missing code-point
range validation. YouTube's four retries per lookup also exceed the configured
function duration under repeated timeouts; its three API stages lack a shared
deadline.

Implement category-on-demand scheduling with one six-request limit and hidden
tab suspension, state-driven rendering, a shared server deadline, bounded
response/cache sizes and in-flight deduplication. Test slow headers/bodies,
retry classification, concurrent callers, malformed content, navigation and
hidden-tab behavior with fixtures before production. No snapshot workflow or
external storage migration is included. Existing recovered local files remain
outside this release. Use existing audit/state files for this diagnosis.

Final local review found two release defects before publishing: the legacy
Python `lib/` ignore rule excluded both new server helpers, and a desktop
dark-mode screenshot showed white selected-tab text on a white background.
Explicit exceptions include only the two runtime helpers. A semantic inverse
text color fixes selected categories and load-more controls in both themes;
the browser fixture now checks their computed foreground/background colors.
