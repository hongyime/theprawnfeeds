"""Browser refresh and rendering regressions with intercepted provider responses."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
WEB = Path(os.environ.get('FEEDS_WEB_ROOT', ROOT / 'public'))
BASE = os.environ.get('FEEDS_BROWSER_URL', 'https://feeds.test').rstrip('/')
CATALOG = json.loads(subprocess.check_output(['node', '-e', "require('./api/feeds')({method:'GET'},{setHeader(){},status(){return this},json(x){process.stdout.write(JSON.stringify(x))}})"], cwd=ROOT, text=True))
FEED_IDS = {feed['url']: f'{section}-{index}' for section, feeds in CATALOG.items() for index, feed in enumerate(feeds)}
SECURITY = {x['key']: x['value'] for x in json.loads((ROOT / 'vercel.json').read_text())['headers'][0]['headers']}


class RefreshBrowser(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch()
        self.page = await self.browser.new_page(viewport={'width': int(os.environ.get('FEEDS_WIDTH', '1440')), 'height': 1000})
        self.page.set_default_timeout(5000)
        self.requests, self.errors = [], []
        self.failed = False
        self.retry_header = '120'
        self.failure_status = 429
        self.hold_retry = None
        self.oldest = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        await self.page.route('**/*', self.route)

    async def asyncTearDown(self):
        if self.hold_retry:
            self.hold_retry[1].set()
        await self.page.close()
        await self.browser.close()
        await self.pw.stop()
        self.assertEqual(self.errors, [])

    async def route(self, route):
        request = route.request
        parsed = urlparse(request.url)
        if parsed.netloc != urlparse(BASE).netloc:
            await route.fulfill(body='', content_type='text/css')
            return
        self.assertEqual(request.method, 'GET')
        if parsed.path == '/api/feeds':
            await route.fulfill(json=CATALOG)
        elif parsed.path == '/api/rss':
            feed = parse_qs(parsed.query)['feedUrl'][0]
            self.requests.append(feed)
            if self.failed and feed == CATALOG['blogs'][0]['url']:
                await route.fulfill(status=self.failure_status, headers={'Retry-After': self.retry_header}, json={'error': 'Synthetic rate limit'})
                return
            if self.hold_retry and feed == CATALOG['blogs'][0]['url']:
                self.hold_retry[0].set()
                await self.hold_retry[1].wait()
            stamp = datetime.now(timezone.utc).isoformat()
            stale = feed in [item['url'] for item in CATALOG['blogs'][1:3]]
            self.assertIn(feed, FEED_IDS)
            items = [{'title': f'Fixture story {i}', 'link': f'https://article.invalid/{FEED_IDS[feed]}/{i}',
                      'pubDate': stamp, 'text': 'Synthetic content', 'thumbnail': ''} for i in range(20)]
            await route.fulfill(json={'title': 'Fixture', 'items': items, 'stale': stale,
                                      'fetched_at': self.oldest if stale else stamp})
        elif BASE != 'https://feeds.test':
            await route.continue_()
        else:
            file = WEB / ('index.html' if parsed.path == '/' else parsed.path.lstrip('/'))
            mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}
            await route.fulfill(path=str(file), content_type=mime.get(file.suffix, 'application/octet-stream'), headers=SECURITY)

    async def start(self):
        await self.page.goto(BASE)
        # CSP forbids page-side eval used by wait_for_function; protocol evaluation
        # executes the exact browser state expression without changing production CSP.
        for _ in range(300):
            if await self.page.evaluate("() => !!feedQueue && feedQueue.summary('blogs').finished === 31"):
                break
            await self.page.wait_for_timeout(25)
        else:
            self.fail('Blog queue did not finish')
        self.assertEqual(len(self.requests), 31)

    async def test_failed_feed_retry_waits_and_only_reloads_that_source(self):
        self.failed = True
        await self.page.clock.install()
        await self.start()
        await self.page.locator('#offline-header').click()
        button = self.page.locator('.retry-feed-btn')
        await expect(button).to_be_disabled()
        self.failed = False
        self.hold_retry = (asyncio.Event(), asyncio.Event())
        await self.page.clock.fast_forward(121000)
        await expect(button).to_be_enabled()
        await button.click()
        await self.hold_retry[0].wait()
        await self.page.locator('.retry-feed-btn').dispatch_event('click')
        self.assertEqual(len(self.requests), 32)
        self.hold_retry[1].set()
        await expect(self.page.locator('#offline-section')).to_be_hidden()
        self.assertEqual(await self.page.evaluate("feedQueue.summary('blogs').failed"), 0)
        self.assertEqual(len(self.requests), 32)

    async def test_default_timeline_exposes_snapshot_age_and_cached_fallbacks(self):
        await self.start()
        status = self.page.locator('#feed-freshness')
        await expect(status).to_contain_text('2 cached')
        await expect(status).to_have_attribute('data-oldest-check', self.oldest)
        self.assertEqual(len(self.requests), 31)

    async def test_http_date_cooldown_and_card_recovery(self):
        self.failed = True
        self.failure_status = 503
        self.retry_header = (datetime.now(timezone.utc) + timedelta(seconds=120)).strftime('%a, %d %b %Y %H:%M:%S GMT')
        await self.page.clock.install()
        await self.start()
        await self.page.locator('#view-fab').click()
        await expect(self.page.locator('#blogs-grid .feed-card')).to_have_count(30)
        await self.page.locator('#offline-header').click()
        await expect(self.page.locator('.retry-feed-btn')).to_be_disabled()
        self.failed = False
        await self.page.clock.fast_forward(121000)
        await self.page.locator('.retry-feed-btn').click()
        await expect(self.page.locator('#blogs-grid .feed-card')).to_have_count(31)
        await expect(self.page.locator('#offline-section')).to_be_hidden()
        self.assertEqual(len(self.requests), 32)

    async def test_show_more_keeps_expansion_and_keyboard_focus(self):
        await self.start()
        button = self.page.locator('#blogs-grid .timeline-more-btn')
        await button.focus()
        await self.page.keyboard.press('Enter')
        await expect(self.page.locator('#blogs-grid .timeline-item')).to_have_count(120)
        self.assertTrue(await self.page.evaluate("document.activeElement === document.querySelectorAll('#blogs-grid .timeline-item-link')[60]"))
        await self.page.locator('#view-fab').click()
        await self.page.locator('#view-fab').click()
        await expect(self.page.locator('#blogs-grid .timeline-item')).to_have_count(120)
        self.assertEqual(len(self.requests), 31)

    async def test_timeline_batches_dom_without_losing_articles_or_refetching(self):
        await self.start()
        articles = self.page.locator('#blogs-grid .timeline-item')
        await expect(articles).to_have_count(60)
        total = 31 * 20
        while await articles.count() < total:
            await self.page.locator('#blogs-grid .timeline-more-btn').click()
        await expect(articles).to_have_count(total)
        self.assertEqual(len(set(await articles.locator('a').evaluate_all('(nodes) => nodes.map(x => x.href)'))), total)
        self.assertEqual(len(self.requests), 31)
        self.assertTrue(await self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
