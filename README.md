# The Prawn Feeds

Live app: https://theprawnfeeds.hong-yi.me/

![Project screenshot](./screenshot.png)

A modern, mobile-first RSS feed aggregator with swipeable navigation, lazy feed loading, and grouped offline-feed reporting.

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
- If the key is missing or the Data API request fails, the app falls back to RSS.

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
