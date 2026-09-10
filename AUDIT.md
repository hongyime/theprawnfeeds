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

Production verification of 228e71a found that `autoAssignCustomDomains` was
false: both public domains stayed on older deployments while the team URL
served the new release. Explicit promotion moved the domains and restored
automatic assignment; the API now reports true and the matching deployment.

The public `/reader` route still returned 404. Its existing rewrite points to
`/index.html` while `cleanUrls` is true. Vercel's configuration documentation
requires extensionless destinations with clean URLs; the index destination
must be `/`. Verify this change against the actual hosted route, not only the
local static server: https://vercel.com/docs/project-configuration/vercel-json.

The hosted browser fixture failed in Playwright's `wait_for_function` with a
CSP EvalError, rather than an app exception. Replace that test helper with
bounded protocol evaluations and serve the production CSP in local fixtures
so CI covers this difference. Keep the application's security headers intact.

The main-branch repeat of Reader checks for 9b8fd56 failed on an immediate
computed-color assertion. A controlled probe using the actual stylesheet and
reduced motion measured rgb(82, 82, 82) immediately after selecting dark mode,
then rgb(189, 189, 189) after two rendered frames. Use Playwright's bounded CSS
assertions to wait for that rendered state. The production font assertion also
ran after DOMContentLoaded while font discovery was still in progress. A probe
waiting for page load and document.fonts.ready observed successful font CSS and
WOFF2 responses, loaded Space Grotesk 400/500/700 faces, and no page/network
errors. Wait for stylesheet loading before asserting fonts; these probes used
synthetic RSS responses and did not fetch provider content.

Waiting for page load alone did not make the full font fixture reliable.
FontFaceSet.ready covers fonts currently used by layout, rather than every
declared weight; the fixture checks weight 500 even when narrow navigation is
hidden. Explicitly load the declared face before checking it. The focused
probe confirmed that FontFaceSet.load resolves a matching Space Grotesk face.
Reference: https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts.

After fonts passed, the production mobile fixture hit its 30-second whole-
category wait while YouTube was still progressing: 106 of 124 feeds finished,
six active requests, zero failed feeds and no page errors. Keep the app's
per-request deadlines unchanged. The fixture now allows at most 120 seconds
for a complete category while failing after 15 seconds without observed
progress; it records category fixture durations. It still requires all 185
unique sources to complete and verifies the single six-request queue.

Two bounded live RSS checks complemented the synthetic tests. The configured
Guanjie feed returned 503 with no-store; its availability remains open.
Hackread returned 200 with one normalized item, fresh-result metadata and
public caching. No YouTube Data API calls or collection workflows were run.
