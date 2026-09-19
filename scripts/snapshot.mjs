import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const feedsHandler = require('../api/feeds.js');
const rssHandler = require('../api/rss.js');

const VALID_CATEGORIES = ['blogs', 'news', 'substack', 'subreddits', 'youtube'];
const DEFAULT_OUTPUT_PATH = 'public/feed-snapshot.json';
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_FETCH_LIMIT = 20;

function createReq(query = {}) {
  return {
    method: 'GET',
    query
  };
}

function createRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    }
  };
}

function getArgValue(args, name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) return args[index + 1];

  return fallback;
}

function normalizeFeedsShape(rawFeeds = {}) {
  return Object.fromEntries(
    VALID_CATEGORIES.map(category => [
      category,
      Array.isArray(rawFeeds?.[category]) ? rawFeeds[category] : []
    ])
  );
}

async function loadFeedsConfig() {
  const res = createRes();
  await feedsHandler(createReq(), res);

  if (res.statusCode !== 200) {
    throw new Error(`Failed to load feeds: HTTP ${res.statusCode}`);
  }

  return normalizeFeedsShape(res.body);
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runOne)
  );

  return results;
}

function normalizeSnapshotItem(item = {}) {
  return {
    title: String(item?.title || '').trim(),
    link: String(item?.link || '').trim(),
    pubDate: String(item?.pubDate || '').trim(),
    text: String(item?.text || '').trim(),
    thumbnail: String(item?.thumbnail || '').trim()
  };
}

async function fetchFeedSnapshotRecord(row, generatedAt, fetchLimit) {
  const res = createRes();

  await rssHandler(createReq({
    feedUrl: row.feed.url,
    limit: String(fetchLimit)
  }), res);

  const ok = res.statusCode === 200;
  const items = ok && Array.isArray(res.body?.items)
    ? res.body.items.map(normalizeSnapshotItem)
    : [];
  const error = ok ? '' : String(res.body?.error || `HTTP ${res.statusCode}`);

  return {
    category: row.category,
    name: String(row.feed?.name || '').trim(),
    url: String(row.feed?.url || '').trim(),
    limit: Number.parseInt(row.feed?.limit, 10) || 3,
    title: ok ? String(res.body?.title || row.feed?.name || '').trim() : '',
    site_url: ok ? String(res.body?.site_url || '').trim() : '',
    items,
    health: {
      ok,
      status: res.statusCode,
      item_count: items.length,
      last_success: ok ? generatedAt : null,
      last_error: ok ? null : error,
      checked_at: generatedAt
    }
  };
}

export async function generateSnapshot(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const feeds = normalizeFeedsShape(options.feeds || await loadFeedsConfig());
  const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || DEFAULT_CONCURRENCY);
  const fetchLimit = Math.max(1, Number.parseInt(options.fetchLimit, 10) || DEFAULT_FETCH_LIMIT);

  const rows = VALID_CATEGORIES.flatMap(category =>
    feeds[category].map(feed => ({ category, feed }))
  );

  const records = await runWithConcurrency(rows, concurrency, row =>
    fetchFeedSnapshotRecord(row, generatedAt, fetchLimit)
  );

  const groupedFeeds = Object.fromEntries(VALID_CATEGORIES.map(category => [category, []]));
  const errors = [];

  for (const record of records) {
    groupedFeeds[record.category].push(record);

    if (!record.health.ok || record.health.item_count === 0) {
      errors.push({
        category: record.category,
        name: record.name,
        url: record.url,
        status: record.health.status,
        error: record.health.last_error || (record.health.item_count === 0 ? 'No items returned' : '')
      });
    }
  }

  return {
    generated_at: generatedAt,
    feed_count: records.length,
    item_count: records.reduce((sum, record) => sum + record.health.item_count, 0),
    feeds: groupedFeeds,
    errors
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outputPath = getArgValue(args, 'output', DEFAULT_OUTPUT_PATH);
  const concurrency = Number.parseInt(getArgValue(args, 'concurrency', String(DEFAULT_CONCURRENCY)), 10);
  const fetchLimit = Number.parseInt(getArgValue(args, 'limit', String(DEFAULT_FETCH_LIMIT)), 10);

  const snapshot = await generateSnapshot({ concurrency, fetchLimit });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const failedCount = snapshot.errors.filter(error => error.status !== 200).length;
  console.log(`Wrote ${outputPath}: ${snapshot.feed_count} feeds, ${snapshot.item_count} items, ${snapshot.errors.length} warning(s), ${failedCount} failed feed(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
