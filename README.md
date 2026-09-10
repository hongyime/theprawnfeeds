# The Prawn Feeds

Live app: https://theprawnfeeds.hong-yi.me/

![Project screenshot](./screenshot.png)

A modern, mobile-first RSS feed aggregator with swipeable navigation, lazy feed loading, and grouped offline-feed reporting.

The reader now loads a category when it is opened, with one six-request queue
shared across navigation. Hidden tabs pause unstarted work; existing requests
finish and their results remain available when you return. Opening only Blogs
requires its 31 feeds rather than all 185 configured sources. Visiting every
category still loads every configured source. This is a request-count reduction,
not a measured Vercel billing saving. No feed catalog entries or stored records
are removed, and no snapshot/collection workflow is added.

Upstream fetches share a 25-second deadline inside the 30-second function limit.
Each attempt includes its response body, is capped at eight seconds and 2 MiB,
and permits at most one transient retry. Rate limits are not immediately
retried. YouTube API stages and any RSS fallback share the same deadline.
Identical in-flight work is reused per instance; at most 16 distinct fetches
run there at once. Response cache payloads are bounded to 8 MiB/256 entries,
fresh for one hour, and usable as an explicitly marked fallback for up to six
hours during upstream failures. These are instance-level controls, not a global
quota guarantee. Public CDN/browser caching remains enabled; failures use
`no-store` and rate limits retain `Retry-After`.

The visual system follows Prawn Projects: Space Grotesk, neutral colors, square
edges, strong borders and visible keyboard focus, with light/dark/system modes.
Run `npm test` for transport, queue and parser contracts. The Reader checks
workflow also exercises desktop/mobile navigation, card/timeline updates,
hidden-tab suspension, modal behavior and catalog failures using synthetic
responses; it never requests real feed content or a YouTube API key.

## Features

### Swipeable Section Navigation
- **5 Sections**: Blogs, News, Substack, Subreddits, YouTube
- **Touch Gestures**: Swipe left/right on mobile devices
- **Keyboard Navigation**: Use arrow keys to navigate
- **Tab Buttons**: Click tabs for direct section access
- **Dynamic Post Counts**: Real-time display of feed counts per section

### Modal Load More System
- **Initial Display**: Uses each feed's configured display limit
- **Load More Button**: Opens modal overlay for additional posts
- **Infinite Scroll**: Loads more posts in batches of 10 inside the modal
- **Multiple Close Methods**: close button, ESC key, or backdrop click
- **Scroll Position Preservation**: Returns to previous position after closing

### Grouped Offline Feeds
- **Auto-Detection**: Identifies failed feed loads
- **Collapsible Section**: Collapsed by default
- **Count Badge**: Shows number of offline feeds
- **Keyboard Accessible**: Toggle with Enter or Space

## Runtime

The production app is Vercel-only:

- Static UI is served from `public/index.html`, `public/app.js`, and `public/styles.css`.
- `GET /api/feeds` reads canonical feed configuration from `feeds.json`.
- `GET /api/rss?feedUrl=...&limit=...` fetches and normalizes configured RSS/Atom feeds.
- `GET /reader` rewrites to the same static reader as `/`.

There is no Flask runtime and no GitHub Pages deployment.

## Configuration

Edit `feeds.json` to customize feed sources:

- Add/remove RSS, Atom, Substack, subreddit, and YouTube channel sources
- Set custom display limits per feed
- Organize sources into sections

`feeds.json` is the single source of truth. The client loads it through `/api/feeds`; there is no generated `public/feeds.js` copy.

Useful feed maintenance commands:

```bash
# Show every configured feed grouped by section
npm run feeds:list

# Validate feed names, URLs, limits, and duplicate URLs
npm run feeds:check

# Live-test a 10-feed sample spread across sections through /api/rss
npm run feeds:smoke

# Live-test one section, or every configured feed
npm run feeds:smoke -- --category blogs --limit 5
npm run feeds:smoke -- --all --concurrency 3
```

`feeds:smoke` reports upstream blocks and rate limits as warnings. That is expected for sources like Reddit when they throttle RSS requests; malformed config and parse failures still fail the command.

### YouTube Reliability Upgrade

YouTube RSS endpoints can intermittently return `404`/`500` for valid channels. The app supports a more robust path using YouTube Data API v3 when `YOUTUBE_API_KEY` is set.

Configure locally with a `.env` file:

```bash
YOUTUBE_API_KEY=your_key_here
```

Configure production in the Vercel project environment variables:

```text
YOUTUBE_API_KEY=your_key_here
```

Behavior:

- If `YOUTUBE_API_KEY` is present, YouTube feeds use the Data API first.
- If the key is missing or the Data API is unavailable, the app falls back to RSS within the same request deadline. Rate limits, oversized responses and an exhausted deadline stop the request without trying another route.

## Security

- `/api/rss` only fetches URLs derived from `feeds.json`.
- RSS fetches use `redirect: 'manual'` and do not follow upstream redirects.
- Upstream XML response bodies are capped before parsing.
- Upstream headers and bodies are never mirrored verbatim; responses are normalized JSON.
- Vercel response headers include CSP, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- Node is pinned to `22.x` through `package.json` `engines.node`; API function duration is pinned in `vercel.json`.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run locally with Vercel routing/functions
npm start

# Deploy to Vercel
vercel deploy
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
