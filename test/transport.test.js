const test = require('node:test');
const assert = require('node:assert/strict');
const { createBudget, fetchText, retryAfterSeconds } = require('../lib/feed-transport');
const { FeedCache } = require('../lib/feed-cache');

test('deadline bounds missing headers even if a transport ignores cancellation', async () => {
  const budget = createBudget(20);
  let signal;
  try {
    await assert.rejects(fetchText('https://fixture.invalid', { budget, retries: 0,
      fetchImpl: (_, options) => { signal=options.signal; return new Promise(() => {}); } }), { status: 504 });
    assert.equal(signal.aborted,true);
  } finally { budget.close(); }
});

test('deadline remains active through a stalled body and cancels the reader', async () => {
  const budget=createBudget(25); let cancelled=false;
  try {
    await assert.rejects(fetchText('https://fixture.invalid', { budget, retries: 0,
      fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})) }), {status:504});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(cancelled,true);
  } finally { budget.close(); }
});

test('body byte cap applies to streamed content without content-length', async () => {
  const budget=createBudget();let cancelled=false;
  try {
    await assert.rejects(fetchText('https://fixture.invalid', { budget, retries: 0,
      fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;}})) }), {status:413});
    assert.equal(cancelled,true);
  } finally {budget.close();}
});

for(const status of [301,401,403,404,429]) test(`HTTP ${status} does not trigger an ordinary-feed retry`,async()=>{
  const budget=createBudget();let calls=0;
  try {
    await assert.rejects(fetchText('https://fixture.invalid',{budget,fetchImpl:async()=>{calls++;return new Response('',{status,headers:{'retry-after':'120'}});}}),{status});
    assert.equal(calls,1);
  }finally{budget.close();}
});

test('one transient retry preserves redirect refusal and returns the next body',async()=>{
  const budget=createBudget();let calls=0;
  try {
    const text=await fetchText('https://fixture.invalid',{budget,fetchImpl:async(_,options)=>{
      assert.equal(options.redirect,'manual');calls++;
      return new Response(calls===1?'':'ok',{status:calls===1?503:200});
    }});
    assert.equal(text,'ok');assert.equal(calls,2);
  }finally{budget.close();}
});

test('Retry-After seconds and dates are preserved',()=>{
  assert.equal(retryAfterSeconds('120'),120);
  assert.equal(retryAfterSeconds('Thu, 10 Sep 2026 00:02:00 GMT',Date.parse('2026-09-10T00:00:00Z')),120);
  assert.equal(retryAfterSeconds('invalid'),60);
});

test('response cache bounds bytes and entries and retains only recent stale data',()=>{
  let now=0;const cache=new FeedCache({maxEntries:2,maxBytes:60,freshMs:10,staleMs:20,now:()=>now});
  cache.set('a',{v:1});cache.set('b',{v:2});cache.get('a');cache.set('c',{v:3});
  assert.equal(cache.get('b'),null);assert.equal(cache.get('a').fresh,true);
  now=10;assert.equal(cache.get('a').fresh,false);
  now=20;assert.equal(cache.get('a'),null);
  cache.set('large',{v:'x'.repeat(100)});assert.equal(cache.get('large'),null);
  for(let n=0;n<100;n++)cache.set(String(n),{v:'x'.repeat(20)});
  assert.ok(cache.bytes<=60);assert.ok(cache.entries.size<=2);
});
