"""Browser contract tests with synthetic feed responses and no provider calls."""
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit
import argparse
import json
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--report-dir')
parser.add_argument('--base-url', help='Verify deployed assets, using synthetic RSS responses only')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=Path(args.report_dir) if args.report_dir else Path(tempfile.mkdtemp(prefix='feeds-browser-'))
out.mkdir(parents=True,exist_ok=True)
mapped=subprocess.run(['node','-e',"require('./api/feeds')({method:'GET'},{setHeader(){},status(){return this},json(data){process.stdout.write(JSON.stringify(data))}})"],cwd=root,capture_output=True,text=True,check=True)
catalog=json.loads(mapped.stdout)
security_headers=json.loads((root/'vercel.json').read_text())['headers'][0]['headers']
assert sum(map(len,catalog.values()))==185
sections={feed['url']:section for section,feeds in catalog.items() for feed in feeds}
first_blog=catalog['blogs'][0]['url']
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(root/'public'),**kw)
    def log_message(self,*a):pass
    def end_headers(self):
        for header in security_headers:self.send_header(header['key'],header['value'])
        super().end_headers()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
Thread(target=server.serve_forever,daemon=True).start()
base=args.base_url.rstrip('/') if args.base_url else 'http://127.0.0.1:'+str(server.server_port)
assert urlsplit(base).scheme in ['http','https']
reports=[]
try:
  with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    for width in [1440,390]:
      page=browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
      def wait_for_state(expression,arg=None):
        # Protocol evaluation works with the production CSP; page-side eval does not.
        deadline=time.monotonic()+30
        while not page.evaluate(expression,arg):
          assert time.monotonic()<deadline, 'Reader state did not settle: '+expression
          page.wait_for_timeout(25)
      category_seconds={}
      def wait_for_category(section):
        started=time.monotonic();last_progress=started;last_finished=-1
        while True:
          progress=page.evaluate('(section)=>feedQueue.summary(section)',section)
          now=time.monotonic()
          assert now-started<120, 'Category exceeded its fixture batch budget: '+section
          if progress['finished']==progress['total']:
            category_seconds[section]=round(now-started,3)
            return
          if progress['finished']!=last_finished:
            last_finished=progress['finished'];last_progress=now
          assert now-last_progress<15, 'Category stopped making progress: '+section
          page.wait_for_timeout(25)
      errors=[];requests=[];held=[];hold=True;external=[]
      page.on('pageerror',lambda e:errors.append(str(e)))
      def fulfill(route):
        url=parse_qs(urlsplit(route.request.url).query)['feedUrl'][0]
        if url==first_blog:
          route.fulfill(status=429,json={'error':'Fixture rate limit'},headers={'Retry-After':'120'})
          return
        now=datetime.now(timezone.utc).isoformat()
        items=[{'title':f'Fixture story {n} <safe>','link':f'https://article.invalid/{n}',
                'pubDate':now,'text':'Synthetic reader content','thumbnail':''} for n in range(20)]
        route.fulfill(json={'title':'Fixture','items':items,'stale':False,'fetched_at':now})
      def route_request(route):
        parts=urlsplit(route.request.url)
        if parts.netloc!=urlsplit(base).netloc:
          external.append(parts.hostname)
          if args.base_url and parts.hostname in ['fonts.googleapis.com','fonts.gstatic.com']:
            route.continue_()
            return
          # Keep test rendering deterministic; no external font/content downloads.
          route.fulfill(status=200,body='',content_type='text/css' if parts.hostname=='fonts.googleapis.com' else 'text/plain')
        elif parts.path=='/api/feeds':
          if args.base_url:route.continue_()
          else:route.fulfill(json=catalog)
        elif parts.path=='/api/rss':
          feed=parse_qs(parts.query)['feedUrl'][0]
          assert feed in sections
          requests.append(feed)
          if hold:held.append(route)
          else:fulfill(route)
        else:route.continue_()
      page.route('**/*',route_request)
      page.goto(base,wait_until='load')
      if args.base_url:
        # ready only covers currently used faces; narrow layouts may not use 500 yet.
        loaded_faces=page.evaluate("""async () => (await document.fonts.load('500 16px "Space Grotesk"')).length""")
        assert loaded_faces>0, 'Space Grotesk has no declared matching font face'
        page.evaluate('document.fonts.ready')
        assert page.evaluate('document.fonts.check(\'500 16px "Space Grotesk"\')'), 'Production font did not load'
        assert page.evaluate("() => [...document.fonts].some(face=>face.family.includes('Space Grotesk') && face.status==='loaded')"), 'No loaded Space Grotesk font face'
      deadline=time.monotonic()+10
      while len(held)<6:
        assert time.monotonic()<deadline,'Initial queue did not start'
        page.wait_for_timeout(25)
      assert len(requests)==6 and all(sections[url]=='blogs' for url in requests)
      page.locator('#view-fab').click()
      assert page.locator('#blogs-grid .feed-card.loading').count()==31
      def navigate(section):
        if page.locator('#hamburger-btn').is_visible():
          page.locator('#hamburger-btn').click()
          page.locator(f'.mobile-nav-item[data-section="{section}"]').click()
        else:page.locator(f'.header-tab[data-section="{section}"]').click()
      navigate('news')
      assert len(requests)==6,'Navigation started a second concurrency pool'
      page.evaluate("""() => {
        window.fixtureHidden=true;
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureHidden});
        document.dispatchEvent(new Event('visibilitychange'));
      }""")
      for route in held[:]:fulfill(route)
      held.clear()
      wait_for_state('() => feedQueue.active === 0')
      assert len(requests)==6,'Hidden tab continued queued requests'
      hold=False
      page.evaluate("window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))")
      wait_for_state("() => feedQueue.summary('news').finished === 13")
      assert len(requests)==19
      assert all(sections[url] in ['blogs','news'] for url in requests)
      assert page.locator('#news-grid .timeline-item').count()>0
      navigate('blogs')
      wait_for_state("() => feedQueue.summary('blogs').finished === 31")
      assert len(requests)==44
      assert page.locator('#blogs-grid .feed-card.loading').count()==0
      assert page.locator('#blogs-grid .feed-card').count()==30
      assert page.locator('#offline-count').inner_text()=='1'
      page.locator('#offline-header').focus();page.keyboard.press('Enter')
      assert page.locator('#offline-content').evaluate("el=>el.classList.contains('expanded')")
      page.locator('#blogs-grid .load-more-btn').first.click()
      assert page.locator('#modal-overlay').evaluate("el=>el.classList.contains('active')")
      assert page.locator('#modal-body .feed-item').count()==12
      page.keyboard.press('Escape')
      assert not page.locator('#modal-overlay').evaluate("el=>el.classList.contains('active')")
      navigate('news');navigate('blogs')
      assert len(requests)==44,'Completed categories were fetched again'
      page.evaluate('window.scrollTo(0,0)')
      page.screenshot(path=str(out/f'feeds-cards-{width}.png'),animations='disabled')
      if page.locator('#mobile-theme-btn').is_visible():
        page.locator('#mobile-theme-btn').click();page.locator('.mobile-theme-option[data-theme="dark"]').click()
      else:page.locator('.theme-btn[data-theme="dark"]').click()
      assert page.locator('html').get_attribute('data-theme')=='dark'
      expect(page.locator('#live-loading-status')).to_have_css('color','rgb(189, 189, 189)')
      # The active category and load-more controls must stay legible in dark mode.
      for selector in ['.header-tab.active', '.mobile-nav-item.active', '.mobile-theme-option.active', '.load-more-btn']:
        expect(page.locator(selector).first).to_have_css('color','rgb(0, 0, 0)')
        expect(page.locator(selector).first).to_have_css('background-color','rgb(255, 255, 255)')
      page.locator('#view-fab').click()
      assert page.locator('#blogs-grid .timeline-item').count()>0
      assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal page overflow'
      page.screenshot(path=str(out/f'feeds-timeline-dark-{width}.png'),animations='disabled')
      for section in ['substack','subreddits','youtube']:
        navigate(section)
        try:
          wait_for_category(section)
        except Exception:
          print(json.dumps({'failed_viewport':width,'requested_section':section,'requests':len(requests),'page_errors':errors,
            'queue':page.evaluate('({current:currentSection,active:feedQueue.active,section:feedQueue.section,visible:feedQueue.visible,summary:feedQueue.summary(currentSection)})')}),flush=True)
          raise
      assert len(requests)==185 and len(set(requests))==185
      assert not errors,errors
      reports.append({'viewport':width,'errors':errors,'catalog_feeds':185,'first_category_feeds':31,
         'requests_before_visiting_remaining_categories':44,'requests_after_visiting_all_categories':len(requests),
         'navigation_during_loading':'passed','hidden_queue_pause':'passed','cards_timeline_modal_theme':'passed',
         'category_fixture_seconds':category_seconds,
         'horizontal_overflow':False,'provider_requests':0,
         'font_downloads':'Space Grotesk verified' if args.base_url else 'stubbed; fallback font used in fixtures'})
      page.close()
    page=browser.new_page(viewport={'width':390,'height':844})
    page.route('**/*',lambda route:route.fulfill(status=503,json={'error':'fixture'}) if urlsplit(route.request.url).path=='/api/feeds'
      else route.continue_() if urlsplit(route.request.url).netloc==urlsplit(base).netloc else route.fulfill(body='',content_type='text/css'))
    page.goto(base,wait_until='domcontentloaded')
    page.locator('#config-error').wait_for(state='visible')
    assert page.locator('#retry-config').is_enabled()
    page.close();browser.close()
  (out/'feeds-browser-checks.json').write_text(json.dumps({'checks':reports,'catalog_failure_visible':True,'deployed_origin':args.base_url},indent=2)+'\n',encoding='utf-8')
  print(json.dumps({'viewports':2,'catalog_feeds':185,'provider_requests':0,'catalog_failure_visible':True,'report_dir':str(out)}))
finally:
  server.shutdown();server.server_close()
