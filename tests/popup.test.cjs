const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {read}=require('./helpers.cjs');
const manifest=JSON.parse(read('manifest.json')), bg=JSON.parse(read('i18n/bg.json')), en=JSON.parse(read('i18n/en.json')), results={};
async function runPopup(){
  const {window,document}=parseHTML(read('popup/popup.html'));
  for (const select of document.querySelectorAll('select')) {
    let val=select.querySelector('option')?.getAttribute('value')||'';
    Object.defineProperty(select,'value',{configurable:true,get:()=>val,set:v=>{val=v;}});
    Object.defineProperty(select,'options',{configurable:true,get:()=>Array.from(select.querySelectorAll('option'))});
  }
  window.location={search:'?fullview=1',hash:''};
  const store={language:'bg',popupFilters:{activeSites:['emag','ozone'],sortMode:'price-asc'},priceTargets:{ozone_B:60}};
  const products={emag_A:{title:'Alpha <script>inert</script>',url:'https://www.emag.bg/alpha/pd/A/',site:'emag',history:[{date:'2026-09-05',price:100},{date:'2026-09-06',price:90}],lastUpdated:'2026-09-06',isActive:true},ozone_B:{title:'Beta',url:'https://www.ozone.bg/product/beta/',site:'ozone',history:[{date:'2026-09-06',price:50}],lastUpdated:'2026-09-06',isActive:true}};
  const calls=[],errors=[];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const chrome={runtime:{getManifest:()=>manifest,getURL:p=>'chrome-extension://audit/'+p,sendMessage:(req,cb)=>{calls.push(req);let response;
    if(req.action==='getAllProducts')response={success:true,products:clone(products)};
    else if(req.action==='getProductCount')response={success:true,count:Object.keys(products).length};
    else if(req.action==='deleteProduct'){delete products[req.productId];response={success:true};}
    else response={success:true};
    cb(response);}},storage:{local:{get:async keys=>Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,clone(store[k])])),set:async data=>Object.assign(store,clone(data)),getBytesInUse:async()=>1234},onChanged:{addListener:()=>{}}},tabs:{create:args=>calls.push({open:args.url})}};
  const context=vm.createContext({window,document,chrome,URL,URLSearchParams,Blob,navigator:{platform:'Win32',clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,console:{log:()=>{},warn:()=>{},error:(...e)=>errors.push(e.map(String).join(' '))},confirm:()=>true,alert:()=>{},fetch:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('/en.json')?en:bg})});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
  for (const file of ['i18n/i18n.js','ui/ui-kit.js','background/price-tracker.js']) vm.runInContext(read(file),context);
  await vm.runInContext(read('popup/popup.js'),context);await tick();
  const cards=()=>document.querySelectorAll('#product-list .card');
  assert.equal(cards().length,2);
  assert.equal(document.querySelector('.card-title').textContent,'Beta');
  assert.equal(document.querySelectorAll('.card-title script').length,0);
  assert.match(document.querySelectorAll('.card-title')[1].textContent,/<script>inert<\/script>/);
  assert.equal(document.querySelector('#tab-products .tab-label').textContent,bg.tabs.products);
  assert.deepEqual(Array.from(document.querySelectorAll('.chip[aria-pressed="true"]')).map(c=>c.dataset.site).sort(),['emag','ozone']);
  assert.equal(document.querySelector('#search-input').value,'');
  assert.match(document.querySelector('.target-chip').textContent,/60,00/);
  assert.equal(document.querySelectorAll('.card')[1].querySelector('.delta.is-down')!==null,true);
  assert(document.body.classList.contains('fullview'));
  document.querySelector('#tab-settings').click();
  assert.equal(document.querySelector('#panel-settings').hidden,false);
  assert.equal(document.querySelector('#panel-products').hidden,true);
  assert.equal(document.querySelectorAll('#panel-settings .switch-input').length,21);
  document.querySelector('#enable-zora').checked=false;document.querySelector('#enable-zora').dispatchEvent(new window.Event('change'));
  assert.equal(store.enableZora,false);
  document.querySelector('.segmented button[data-lang="en"]').click();await tick();
  assert.equal(document.querySelector('#tab-products .tab-label').textContent,en.tabs.products);
  assert.equal(store.language,'en');
  const del=document.querySelector('.card-delete');
  del.click();assert.equal(cards().length,2,'first click only arms the delete');
  del.click();await tick();
  assert.equal(cards().length,1);
  assert.deepEqual(calls.filter(c=>c.action==='deleteProduct').map(c=>c.productId),['ozone_B']);
  document.querySelector('.card-open').click();
  assert.equal(calls.at(-1).open,'https://www.emag.bg/alpha/pd/A/');
  assert.equal(errors.length,0,errors.join('\n'));
  results.popup={passed:['initial populated render','ascending price sort','filter restoration','transient search','target marker','price trend','inert HTML in product title','full tab mode','tab switch','store toggle','BG/EN language switch','two-step delete and rerender','validated open'],errors};
}

test('popup rendering, filters, language switching, and deletion', runPopup);

test('popup refuses to open unsupported product URLs',async()=>{
  const {window,document}=parseHTML(read('popup/popup.html'));
  for (const select of document.querySelectorAll('select')) {
    let val='recent';
    Object.defineProperty(select,'value',{configurable:true,get:()=>val,set:v=>{val=v;}});
    Object.defineProperty(select,'options',{configurable:true,get:()=>Array.from(select.querySelectorAll('option'))});
  }
  window.location={search:'',hash:''};
  const opened=[];
  const products={ozone_x:{title:'Evil',url:'javascript:alert(1)',site:'ozone',history:[{date:'2026-09-06',price:5}],lastUpdated:'2026-09-06',isActive:true}};
  const chrome={runtime:{getManifest:()=>manifest,getURL:p=>p,sendMessage:(req,cb)=>cb(req.action==='getAllProducts'?{success:true,products}:{success:true})},
    storage:{local:{get:async()=>({}),set:async()=>{},getBytesInUse:async()=>0},onChanged:{addListener:()=>{}}},tabs:{create:a=>opened.push(a.url)}};
  const context=vm.createContext({window,document,chrome,URL,URLSearchParams,navigator:{platform:'Win32'},setTimeout,clearTimeout,console:{log(){},warn(){},error(){}},
    fetch:async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>bg})});
  for (const file of ['i18n/i18n.js','ui/ui-kit.js','background/price-tracker.js']) vm.runInContext(read(file),context);
  await vm.runInContext(read('popup/popup.js'),context);
  assert.equal(document.querySelectorAll('.card').length,1);
  assert.equal(document.querySelector('.card-open'),null);
  assert.deepEqual(opened,[]);
});
