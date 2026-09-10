const test=require('node:test');
const assert=require('node:assert/strict');
const FEED='https://guanjiefung.com/feed/';
const XML='<rss><channel><title>Fixture</title><item><title><![CDATA[Broken &#1114112;]]></title><link>https://example.invalid/post</link></item></channel></rss>';
function handler(){delete require.cache[require.resolve('../api/rss')];return require('../api/rss');}
function response(){return{headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;},end(){}};}
function request(limit='1'){return{method:'GET',query:{feedUrl:FEED,limit}};}
test('concurrent identical callers share one upstream fetch and a fresh result',async(t)=>{
  const original=global.fetch;t.after(()=>{global.fetch=original;});
  let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
  global.fetch=async()=>{calls++;await gate;return new Response(XML);};
  const run=handler(),a=response(),b=response();
  const work=[run(request(),a),run(request(),b)];await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);release();await Promise.all(work);
  const c=response();await run(request(),c);assert.equal(calls,1);
  for(const result of [a,b,c]){assert.equal(result.code,200);assert.equal(result.body.stale,false);assert.ok(result.body.items[0].title.includes('1114112'));}
});
test('upstream rate limiting is not retried and has a bounded per-instance cooldown',async(t)=>{
  const original=global.fetch;t.after(()=>{global.fetch=original;});let calls=0;
  global.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});};
  const run=handler(),a=response(),b=response();await run(request(),a);await run(request('2'),b);
  assert.equal(calls,1);assert.equal(a.code,429);assert.equal(b.code,429);
  assert.equal(a.headers['Retry-After'],'120');assert.equal(a.headers['Cache-Control'],'no-store');
});
test('distinct concurrent work is bounded while duplicate work remains shareable',async(t)=>{
  const original=global.fetch;t.after(()=>{global.fetch=original;});let release,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});global.fetch=async()=>{calls++;await gate;return new Response(XML);};
  const run=handler();const active=Array.from({length:16},(_,i)=>run(request(String(i+1)),response()));
  try{await new Promise(resolve=>setImmediate(resolve));const busy=response();await run(request('17'),busy);
    assert.equal(busy.code,503);assert.equal(busy.headers['Retry-After'],'5');assert.equal(calls,16);
  }finally{release();await Promise.all(active);}
});
test('a stalled body reaches the overall deadline and produces a non-cacheable 504',async(t)=>{
  const original=global.fetch;t.after(()=>{global.fetch=original;});
  t.mock.timers.enable({apis:['setTimeout','Date']});let cancelled=false,calls=0;
  global.fetch=async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}));};
  const run=handler(),res=response();const pending=run(request(),res);
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(25001);await pending;
  assert.equal(res.code,504);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(calls,1);assert.equal(cancelled,true);
});

function youtubeRequest() {
  const channel=require('../feeds.json').youtube_channels[0].channel_id;
  return {method:'GET',query:{feedUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,limit:'2'}};
}
function withYoutubeKey(t) {
  const original=process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY='fixture-key-0123456789abcdefgh';
  t.after(()=>{if(original===undefined)delete process.env.YOUTUBE_API_KEY;else process.env.YOUTUBE_API_KEY=original;});
}
test('YouTube channel, playlist and video stages retain normalization and redirect refusal',async(t)=>{
  withYoutubeKey(t);const original=global.fetch;t.after(()=>{global.fetch=original;});const paths=[];
  global.fetch=async(url,options)=>{
    const path=new URL(url).pathname;paths.push(path);assert.equal(options.redirect,'manual');
    if(path.endsWith('/channels'))return Response.json({items:[{snippet:{title:'Fixture channel'},contentDetails:{relatedPlaylists:{uploads:'fixture-list'}}}]});
    if(path.endsWith('/playlistItems'))return Response.json({items:[{contentDetails:{videoId:'fixture0001'}},{contentDetails:{videoId:'fixture0002'}}]});
    if(path.endsWith('/videos'))return Response.json({items:[
      {id:'fixture0001',contentDetails:{duration:'PT4M'},snippet:{title:'Long fixture',publishedAt:'2026-09-10'}},
      {id:'fixture0002',contentDetails:{duration:'PT1M'},snippet:{title:'Brief fixture',publishedAt:'2026-09-10'}}
    ]});
    throw new Error('Unexpected provider route');
  };
  const res=response();await handler()(youtubeRequest(),res);
  assert.equal(res.code,200);assert.equal(paths.length,3);assert.equal(res.body.items.length,1);
  assert.equal(res.body.items[0].title,'Long fixture');
});
test('all YouTube stages share one overall deadline without extra RSS work on expiry',async(t)=>{
  withYoutubeKey(t);const original=global.fetch;t.after(()=>{global.fetch=original;});
  t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0,cancelled=false;
  global.fetch=async()=>{
    calls++;
    if(calls===1){t.mock.timers.tick(7000);return Response.json({items:[{contentDetails:{relatedPlaylists:{uploads:'fixture-list'}}}]});}
    if(calls===2){t.mock.timers.tick(7000);return Response.json({items:[{contentDetails:{videoId:'fixture0001'}}]});}
    return new Response(new ReadableStream({cancel(){cancelled=true;}}));
  };
  const res=response(),pending=handler()(youtubeRequest(),res);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);
  t.mock.timers.tick(11001);await pending;
  assert.equal(res.code,504);assert.equal(calls,3);assert.equal(cancelled,true);
});
