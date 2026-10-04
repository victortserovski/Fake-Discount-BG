const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { harness, observation, product, read } = require('./helpers.cjs');

test('price parsing isolates EUR and supports decimal/grouping separators', () => {
  const h = harness(); h.load('content/product-parser.js');
  for (const [input, expected] of [['29,99 EUR / 58,66 BGN',29.99],['1,199.00 EUR',1199],['1.199,00 €',1199],['1 199,00 лв.',1199],['22,10 € / 43,22 лв.',22.1]]) {
    assert.equal(vm.runInContext(`ProductParser.parsePrice(${JSON.stringify(input)})`,h.context), expected);
  }
});

test('SportDepot keeps the full model and color suffix', () => {
  const h = harness(); h.load('content/product-parser.js');
  for (const model of ['HM6803-101','AB1234-101']) {
    assert.equal(vm.runInContext(`ProductParser.extractProductId('https://www.sportdepot.bg/product/shoe-N_${model}-basic.html?i=10')`,h.context),'sportdepot_'+model);
  }
});

test('flat prices are stable; rebound without a promotion is not a fake discount', () => {
  const h=harness(); h.load('background/price-tracker.js');
  const history=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return {date:d.toISOString().slice(0,10),price:100};});
  assert.equal(h.context.detectFakeDiscount({currentPrice:100,originalPrice:null,history}).verdict,'STABLE_PRICE');
  history[6].price=120;
  assert.equal(h.context.detectFakeDiscount({currentPrice:120,originalPrice:null,history}).verdict,'VOLATILE_PRICE');
  assert.equal(h.context.detectFakeDiscount({currentPrice:120,originalPrice:200,history}).verdict,'FAKE_DISCOUNT');
});

test('concurrent first migration and saves retain every product', async () => {
  const h=harness({priceHistory:{ozone_old:product(5,'old')},p_ozone_orphan:product(6,'orphan')});
  h.load('utils/storage.js');const manager=new h.context.PriceStorageManager();
  await Promise.all(Array.from({length:20},(_,i)=>manager.saveProduct('ozone_'+i,observation(i+1,String(i)))));
  const products=await manager.getAllProducts();
  assert.equal(Object.keys(products).length,22);
  assert.equal(products.ozone_orphan.history[0].price,6);
});

test('failed migration blocks writes and can retry without losing history', async () => {
  let fail=true;
  const h=harness({priceHistory:{ozone_old:product()}},{set:async data=>{if(fail && data.storage_migrated_v2)throw Error('quota');}});
  h.load('utils/storage.js');const manager=new h.context.PriceStorageManager();
  await assert.rejects(manager.saveProduct('ozone_new',observation()));
  assert.equal(h.state.p_ozone_new,undefined);
  fail=false;await manager.saveProduct('ozone_new',observation());
  assert.equal(Object.keys(await manager.getAllProducts()).length,2);
});

test('clear/save overlap cannot orphan product records and repeat clear removes all', async () => {
  const h=harness({storage_migrated_v2:true,p_ozone_orphan:product()});h.load('utils/storage.js');
  const manager=new h.context.PriceStorageManager();await manager.ensureMigrated();
  await Promise.all([manager.saveProduct('ozone_a',observation()),manager.clearAll(),manager.saveProduct('ozone_b',observation())]);
  const keys=Object.keys(h.state).filter(k=>k.startsWith('p_') && h.state[k]).map(k=>k.slice(2)).sort();
  assert.deepEqual([...(h.state.product_index||[])].sort(),keys);
  await manager.clearAll();assert.equal(Object.keys(h.state).some(k=>k.startsWith('p_')),false);
});

test('bulk import quota failure changes no product or index', async () => {
  let fail=false;
  const initial={storage_migrated_v2:true,p_ozone_a:product(10,'a'),p_ozone_b:product(20,'b')};
  const h=harness(initial,{set:async data=>{if(fail&&data.p_ozone_b)throw Error('quota');}});h.load('background/service-worker.js');
  // Reconciliation completes before the injected bulk-write failure.
  await h.send({action:'getAllProducts'});fail=true;
  const response=await h.send({action:'importData',data:{priceHistory:{ozone_a:product(99,'a'),ozone_b:product(88,'b')}}});
  assert.equal(response.success,false);
  assert.deepEqual([h.state.p_ozone_a.history[0].price,h.state.p_ozone_b.history[0].price],[10,20]);
  assert.deepEqual([...h.state.product_index].sort(),['ozone_a','ozone_b']);
});

test('import sorts and deduplicates days and rejects mismatched IDs', async () => {
  const h=harness();h.load('background/service-worker.js');
  const p=product();p.history=[{date:'2026-09-06',price:10},{date:'2026-09-01',price:100},{date:'2026-09-06',price:9},{date:'2026-02-30',price:1}];
  const result=await h.send({action:'importData',data:{priceHistory:{ozone_a:p,ozone_wrong:p}}});
  assert.equal(result.imported,1);assert.equal(result.skipped,1);
  assert.deepEqual(h.state.p_ozone_a.history.map(h=>h.price),[100,9]);
  assert.equal(h.state.p_ozone_a.lastUpdated,'2026-09-06');
});

test('target writes are serialized and restricted to the sender product', async () => {
  const h=harness();h.load('background/service-worker.js');
  const sender=id=>({url:observation(1,id).url,tab:{id:1,url:observation(1,id).url}});
  const responses=await Promise.all(['a','b'].map((id,i)=>h.send({action:'setPriceTarget',productId:'ozone_'+id,value:80+i},sender(id))));
  assert(responses.every(r=>r.success));assert.deepEqual(h.state.priceTargets,{ozone_a:80,ozone_b:81});
  assert.equal((await h.send({action:'setPriceTarget',productId:'ozone_b',value:20},sender('a'))).success,false);
});

test('secure uploads share one persisted identity and carry chronological timestamps', async () => {
  const calls=[];
  const h=harness({supabase_device_id:'legacy-kept'},{fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true};}});
  h.load('utils/supabase-sync.js');
  const entry={...observation(),productId:'ozone_a',date:'2026-09-06'};
  await Promise.all([h.context.SupabaseSync.pushDatapoint(entry),h.context.SupabaseSync.pushDatapoint({...entry,productId:'ozone_b',price:8})]);
  await h.context.SupabaseSync.flushPending();
  assert.equal(calls.length,2);assert.equal(calls[0].body.installation_secret,calls[1].body.installation_secret);
  assert(calls.every(c=>c.url.endsWith('/rpc/ingest_price_observation')));
  assert(calls[0].body.observation.client_observed_at<calls[1].body.observation.client_observed_at);
  assert.equal(h.state.supabase_device_id,'legacy-kept');
  assert.equal(await h.context.SupabaseSync.getDeviceId(),h.state.supabase_identity.deviceId);
});

test('failed uploads survive worker restart and newer visits replace a queued day',async()=>{
  const entry={...observation(),productId:'ozone_a',date:'2026-09-06'};
  const offline=harness({}, {fetch:async()=>{throw Error('offline');}});offline.load('utils/supabase-sync.js');
  await offline.context.SupabaseSync.pushDatapoint(entry);
  await offline.context.SupabaseSync.pushDatapoint({...entry,price:8});
  const keys=Object.keys(offline.state).filter(k=>k.startsWith('sync_pending_'));
  assert.equal(keys.length,1);assert.equal(offline.state[keys[0]].price,8);
  const calls=[];
  const online=harness(offline.state,{fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true};}});
  online.load('utils/supabase-sync.js');await online.context.SupabaseSync.flushPending();
  assert.equal(calls[0].observation.price,8);
  assert.equal(Object.keys(online.state).filter(k=>k.startsWith('sync_pending_')).length,0);
});

test('acknowledging an in-flight upload never removes a newer queued observation',async()=>{
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});
  const h=harness({}, {fetch:async()=>{started();await new Promise(resolve=>{release=resolve;});return {ok:true};}});
  h.load('utils/supabase-sync.js');const entry={...observation(),productId:'ozone_a',date:'2026-09-06'};
  const first=h.context.SupabaseSync.pushDatapoint(entry);await waiting;
  const second=h.context.SupabaseSync.pushDatapoint({...entry,price:8});
  while(!Object.values(h.state).some(v=>v?.product_id==='ozone_a'&&v.price===8))await new Promise(resolve=>setImmediate(resolve));
  release();await Promise.all([first,second]);
  assert.equal(h.state['sync_pending_ozone_a:2026-09-06'].price,8);
});

test('imported image URLs cannot make popup tracking requests',async()=>{
  const h=harness();h.load('background/service-worker.js');
  const result=await h.send({action:'importData',data:{priceHistory:{ozone_a:{...product(),thumbnail:'https://tracker.example/unique-person'}}}});
  assert.equal(result.imported,1);assert.equal(h.state.p_ozone_a.thumbnail,null);
});

test('identity initialization retries after storage failure',async()=>{
  let fail=true;const h=harness({}, {set:async data=>{if(fail&&data.supabase_identity)throw Error('quota');}});h.load('utils/supabase-sync.js');
  await assert.rejects(h.context.SupabaseSync.getDeviceId());fail=false;
  assert.equal(await h.context.SupabaseSync.getDeviceId(),h.state.supabase_identity.deviceId);
});

test('translation keys and placeholders match and errors are localized',()=>{
  const flatten=(o,p='')=>Object.fromEntries(Object.entries(o).flatMap(([k,v])=>typeof v==='object'?Object.entries(flatten(v,p+k+'.')):[[p+k,v]]));
  const bg=flatten(JSON.parse(read('i18n/bg.json'))),en=flatten(JSON.parse(read('i18n/en.json')));
  assert.deepEqual(Object.keys(bg).sort(),Object.keys(en).sort());
  for(const k of Object.keys(en))assert.deepEqual((bg[k].match(/\{\w+\}/g)||[]).sort(),(en[k].match(/\{\w+\}/g)||[]).sort(),k);
});
