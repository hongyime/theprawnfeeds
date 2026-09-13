const test=require('node:test');
const assert=require('node:assert/strict');
const {FeedQueue}=require('../public/feed-queue');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const started=[];const pending=[];
  const entries=['blogs','news','youtube'].flatMap(section=>Array.from({length:4},(_,n)=>({section,n})));
  const queue=new FeedQueue(entries,{limit:2,run:entry=>{started.push(entry);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
  return {queue,started,pending};
}
test('initial load only starts the selected category and respects concurrency',async()=>{
  const {queue,started,pending}=fixture();queue.setView('blogs');await tick();
  assert.equal(started.length,2);assert.ok(started.every(e=>e.section==='blogs'));
  pending.shift().resolve();await tick();assert.equal(started.length,3);assert.equal(queue.active,2);
  queue.setView('blogs',false);for(const p of pending.splice(0))p.resolve();await tick();
  assert.equal(queue.active,0);assert.equal(started.length,3);
});
test('navigation prioritizes the new category without creating a second concurrency pool',async()=>{
  const {queue,started,pending}=fixture();queue.setView('blogs');await tick();queue.setView('news');
  pending.shift().resolve();await tick();assert.equal(started.at(-1).section,'news');assert.equal(queue.active,2);
  queue.setView('news',false);for(const p of pending.splice(0))p.resolve();await tick();
});
test('hidden tabs pause queued work and returning categories resume without repeating completed feeds',async()=>{
  const {queue,started,pending}=fixture();queue.setView('blogs',false);await tick();assert.equal(started.length,0);
  queue.setView('blogs',true);await tick();queue.setView('blogs',false);
  for(const p of pending.splice(0))p.resolve();await tick();assert.equal(started.length,2);
  queue.setView('blogs',true);await tick();assert.equal(started.length,4);
  for(const p of pending.splice(0))p.resolve();await tick();
  queue.setView('blogs');await tick();assert.equal(started.length,4);assert.deepEqual(queue.summary('blogs'),{total:4,finished:4,failed:0});
});
test('failed requests release slots and are reported without an automatic retry loop',async()=>{
  const {queue,started,pending}=fixture();queue.setView('blogs');await tick();
  pending.shift().reject(new Error('fixture unavailable'));await tick();assert.equal(started.length,3);
  assert.equal(queue.summary('blogs').failed,1);queue.setView('blogs',false);
  for(const p of pending.splice(0))p.resolve();await tick();
});

test('manual retries honor cooldowns, share the queue and reject double clicks', async () => {
  const {queue,started,pending}=fixture();queue.setView('blogs');await tick();
  const first=queue.entries[0];const error=Object.assign(new Error('limited'),{retryAt:120000});
  pending.shift().reject(error);await tick();queue.setView('blogs',false);
  for(const item of pending.splice(0))item.resolve();await tick();
  const before=started.length;
  assert.equal(queue.retry(first,119999),false);
  assert.equal(queue.retry(first,120000),true);
  assert.equal(queue.retry(first,120000),false);
  await tick();assert.equal(started.length,before,'Hidden tabs do not start retry work');
  queue.setView('blogs',true);await tick();assert.equal(started.filter(e=>e===first).length,2);
  assert.ok(queue.active<=2);
  for(const item of pending.splice(0))item.resolve();await tick();
  assert.equal(first.status,'success');assert.equal(queue.retry(first,200000),false);
});
