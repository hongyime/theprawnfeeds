const test = require('node:test');
const assert = require('node:assert/strict');

const feedsHandler = require('../api/feeds');
const rssHandler = require('../api/rss');

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
    ended: false,
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
      this.ended = true;
      return this;
    }
  };
}

test('feeds API maps canonical config for the client', async () => {
  const res = createRes();

  await feedsHandler(createReq(), res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.blogs));
  assert.ok(Array.isArray(res.body.news));
  assert.ok(Array.isArray(res.body.substack));
  assert.ok(Array.isArray(res.body.subreddits));
  assert.ok(Array.isArray(res.body.youtube));
  assert.ok(res.body.blogs.some(feed => feed.url === 'https://guanjiefung.com/feed/'));
});

test('rss API rejects unconfigured URLs before outbound fetch', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called');
  };

  try {
    const res = createRes();

    await rssHandler(createReq({ feedUrl: 'http://127.0.0.1/latest', limit: '1' }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'feedUrl is not configured');
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rss API fetches configured URLs with manual redirects and returns normalized JSON', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  let fetchOptions = {};

  global.fetch = async (url, options) => {
    requestedUrl = url;
    fetchOptions = options;

    return new Response(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Fixture Feed</title>
          <item>
            <title><![CDATA[Hello <b>world</b>]]></title>
            <link>https://example.com/post</link>
            <pubDate>Fri, 21 Aug 2026 00:00:00 GMT</pubDate>
            <description><![CDATA[Text <script>alert(1)</script> body]]></description>
          </item>
        </channel>
      </rss>`, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml'
      }
    });
  };

  try {
    const res = createRes();

    await rssHandler(createReq({ feedUrl: 'https://guanjiefung.com/feed/', limit: '1' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(requestedUrl, 'https://guanjiefung.com/feed/');
    assert.equal(fetchOptions.redirect, 'manual');
    assert.equal(res.body.title, 'Fixture Feed');
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].title, 'Hello world');
    assert.match(res.body.items[0].text, /^Text\s+body$/);
    assert.equal(res.body.items[0].text.includes('alert'), false);
  } finally {
    global.fetch = originalFetch;
  }
});
