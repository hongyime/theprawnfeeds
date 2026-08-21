# PRD: theprawnfeeds

## Overview

A Vercel-hosted RSS dashboard that serves a static vanilla JavaScript client and Node.js serverless API functions. The app aggregates configured RSS/Atom, Substack, subreddit, and YouTube sources from `feeds.json` into a mobile-first reader.

## Goals

- Aggregate configured feeds from a single `feeds.json` source of truth
- Serve a fast static reader at `/` and `/reader`
- Load feed configuration through `/api/feeds`
- Fetch only owner-configured feed URLs through `/api/rss`
- Normalize third-party feed XML into JSON before it reaches the browser
- Deploy serverlessly on Vercel with pinned Node engine, explicit function duration, and security headers

## Non-Goals

- User authentication or personalization
- In-app feed subscription management
- Persistent database
- GitHub Pages deployment
- Python or Flask runtime

## User Stories

- As Bryan, I want a single page that shows the latest content from followed feeds.
- As a visitor, I want to browse aggregated content without signing in.
- As the owner, I want feed URLs controlled by config rather than caller input.

## Tech Stack

- **Client**: Vanilla JavaScript, HTML, CSS
- **API runtime**: Vercel Node.js functions
- **Parsing**: `fast-xml-parser`
- **Sanitization**: local HTML tag stripping and entity decoding in `api/rss.js`
- **Data**: `feeds.json`
- **Deployment**: Vercel

## Architecture

```text
theprawnfeeds/
├── api/
│   ├── feeds.js        # Maps feeds.json into client feed categories
│   └── rss.js          # Fetches and normalizes allowlisted RSS/Atom feeds
├── feeds.json          # Canonical feed source config
├── public/
│   ├── index.html      # Static reader shell
│   ├── app.js          # Client app logic
│   └── styles.css      # Reader styles
├── package.json
└── vercel.json         # Vercel functions, headers, rewrites
```

## Features

### Feed Types

| Type | Source | Method |
|------|--------|--------|
| RSS/Atom | Configured feed URLs | `/api/rss` fetch + XML parse |
| Substack | Configured feed URLs | `/api/rss` fetch + XML parse |
| Reddit | Configured subreddit RSS URLs | `/api/rss` fetch + XML parse |
| YouTube | Channel RSS or Data API fallback | `/api/rss` with optional `YOUTUBE_API_KEY` |

### Client Loading

- Client starts from `public/index.html`
- `public/app.js` loads feed config from `/api/feeds`
- Feed cards load asynchronously through `/api/rss`
- Modal view loads additional already-fetched items in batches
- Offline-feed UI tracks failed feed requests by section

### SSRF Protection

- `/api/rss` accepts a `feedUrl` query parameter only when it exactly matches a URL derived from `feeds.json`
- Fetches use `redirect: 'manual'`
- XML response size is capped before parsing
- API responses are normalized JSON with application-controlled headers

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feeds` | Return mapped feed configuration from `feeds.json` |
| `GET` | `/api/rss` | Fetch and parse one configured feed URL |
| `GET` | `/reader` | Rewrite to `/index.html` |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `YOUTUBE_API_KEY` | Optional YouTube Data API v3 key for more reliable channel loading |

## Deployment / Run

```bash
npm install
npm test
npm start
```

Vercel serves `public/` as static assets and `api/*.js` as Node.js functions.

## Constraints & Notes

- Feed data is still fetched on user page loads; a scheduled static snapshot remains the preferred future architecture.
- Serverless memory cache is best-effort and can reset on cold starts.
- `feeds.json` must be edited manually to add/remove sources.
