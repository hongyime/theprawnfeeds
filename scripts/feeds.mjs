import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const feedsHandler = require('../api/feeds.js');
const rssHandler = require('../api/rss.js');

const VALID_CATEGORIES = ['blogs', 'news', 'substack', 'subreddits', 'youtube'];

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

async function loadFeeds() {
  const res = createRes();
  await feedsHandler(createReq(), res);

  if (res.statusCode !== 200) {
    throw new Error(`Failed to load feeds: HTTP ${res.statusCode}`);
  }

  return res.body;
}

function flattenFeeds(feeds, categoryFilter = '') {
  const rows = [];

  for (const category of VALID_CATEGORIES) {
    if (categoryFilter && category !== categoryFilter) continue;

    for (const feed of feeds[category] || []) {
      rows.push({
        category,
        name: String(feed?.name || '').trim(),
        url: String(feed?.url || '').trim(),
        limit: Number.parseInt(feed?.limit, 10) || 3
      });
    }
  }

  return rows;
}

function sampleFeedsAcrossCategories(feeds, sampleSize) {
  const categories = VALID_CATEGORIES.filter(category => feeds[category]?.length);
  const perCategory = Math.max(1, Math.ceil(sampleSize / categories.length));
  const selected = [];

  for (const category of categories) {
    for (const feed of (feeds[category] || []).slice(0, perCategory)) {
      selected.push({
        category,
        name: String(feed?.name || '').trim(),
        url: String(feed?.url || '').trim(),
        limit: Number.parseInt(feed?.limit, 10) || 3
      });
    }
  }

  return selected.slice(0, sampleSize);
}

function validateFeeds(rows) {
  const errors = [];
  const seenUrls = new Set();

  rows.forEach((feed, index) => {
    const label = `${feed.category}[${index}]`;

    if (!feed.name) {
      errors.push(`${label}: missing name`);
    }

    if (!feed.url) {
      errors.push(`${label}: missing url`);
    } else {
      try {
        const parsed = new URL(feed.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push(`${label}: url must use http/https`);
        }
      } catch {
        errors.push(`${label}: invalid url ${feed.url}`);
      }
    }

    if (!Number.isInteger(feed.limit) || feed.limit < 1 || feed.limit > 50) {
      errors.push(`${label}: limit must be between 1 and 50`);
    }

    const urlKey = feed.url.toLowerCase();
    if (urlKey && seenUrls.has(urlKey)) {
      errors.push(`${label}: duplicate url ${feed.url}`);
    }
    seenUrls.add(urlKey);
  });

  return errors;
}

function printSummary(feeds) {
  const counts = Object.fromEntries(
    VALID_CATEGORIES.map(category => [category, feeds[category]?.length || 0])
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  console.log(`Total feeds: ${total}`);
  for (const category of VALID_CATEGORIES) {
    console.log(`${category}: ${counts[category]}`);
  }
}

function printList(feeds, categoryFilter = '') {
  printSummary(feeds);

  for (const category of VALID_CATEGORIES) {
    if (categoryFilter && category !== categoryFilter) continue;

    console.log(`\n[${category}]`);
    for (const feed of feeds[category] || []) {
      console.log(`- ${feed.name} (${feed.limit}): ${feed.url}`);
    }
  }
}

async function smokeFeed(feed) {
  const res = createRes();

  await rssHandler(createReq({
    feedUrl: feed.url,
    limit: '1'
  }), res);

  return {
    ...feed,
    status: res.statusCode,
    ok: res.statusCode === 200,
    title: res.body?.title || '',
    itemCount: Array.isArray(res.body?.items) ? res.body.items.length : 0,
    error: res.body?.error || '',
    upstreamWarning: [429, 503].includes(res.statusCode)
      || /rate|blocked by upstream/i.test(String(res.body?.error || ''))
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runOne)
  );

  return results;
}

async function main() {
  const [command = 'list', ...args] = process.argv.slice(2);
  const category = getArgValue(args, 'category');

  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new Error(`Unknown category "${category}". Use one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  const feeds = await loadFeeds();
  const rows = flattenFeeds(feeds, category);

  if (command === 'list') {
    printList(feeds, category);
    return;
  }

  if (command === 'check') {
    const errors = validateFeeds(rows);
    printSummary(feeds);

    if (errors.length) {
      console.error(`\nConfig errors (${errors.length}):`);
      errors.forEach(error => console.error(`- ${error}`));
      process.exitCode = 1;
      return;
    }

    console.log('\nFeed config shape is valid.');
    return;
  }

  if (command === 'smoke') {
    const sampleSize = Number.parseInt(getArgValue(args, 'limit', '10'), 10);
    const all = args.includes('--all');
    const selected = all
      ? rows
      : category
        ? rows.slice(0, Math.max(1, sampleSize || 10))
        : sampleFeedsAcrossCategories(feeds, Math.max(1, sampleSize || 10));
    const concurrency = Math.max(1, Number.parseInt(getArgValue(args, 'concurrency', '3'), 10) || 3);

    console.log(`Smoke testing ${selected.length} feed(s) with concurrency ${concurrency}...`);
    const results = await runWithConcurrency(selected, concurrency, smokeFeed);
    const failures = results.filter(result => !result.upstreamWarning && (!result.ok || result.itemCount === 0));
    const warnings = results.filter(result => result.upstreamWarning);

    for (const result of results) {
      const status = result.ok && result.itemCount > 0 ? 'OK' : result.upstreamWarning ? 'UPSTREAM' : 'FAIL';
      const detail = result.upstreamWarning
        ? result.error || 'upstream temporarily blocked this request'
        : result.error || `${result.itemCount} item(s), title: ${result.title || 'Unknown'}`;
      console.log(`${status} ${result.category} / ${result.name}: HTTP ${result.status}, ${detail}`);
    }

    if (warnings.length) {
      console.warn(`\nUpstream warnings: ${warnings.length}/${results.length}`);
    }

    if (failures.length) {
      console.error(`\nSmoke failures: ${failures.length}/${results.length}`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nSmoke passed: ${results.length - warnings.length}/${results.length}`);
    return;
  }

  throw new Error('Usage: npm run feeds:list | feeds:check | feeds:smoke -- [--limit 10] [--all] [--category blogs] [--concurrency 3]');
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
