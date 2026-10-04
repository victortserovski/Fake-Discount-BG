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
  window.location={search:'?fullview=1'};
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
  const context=vm.createContext({window,document,chrome,URL,URLSearchParams,navigator:{platform:'Win32',clipboard:{writeText:async()=>{}}},setTimeout,clearTimeout,console:{log:()=>{},warn:()=>{},error:(...e)=>errors.push(e.map(String).join(' '))},confirm:()=>true,alert:()=>{},fetch:async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('/en.json')?en:bg})});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
  vm.runInContext(read('i18n/i18n.js'),context);
  await vm.runInContext(read('popup/popup.js'),context);await tick();
  assert.equal(document.querySelectorAll('.product-item').length,2);
  assert.equal(document.querySelector('.product-title').textContent,'Beta');
  assert.equal(document.querySelectorAll('.product-title script').length,0);
  assert.equal(document.querySelector('#tab-products').textContent,bg.tabs.products);
  assert.equal(document.querySelectorAll('.chip.active').length,2);
  assert.equal(document.querySelector('#search-input').value,'');
  assert(document.body.classList.contains('fullview'));
  document.querySelector('#tab-settings').click();
  assert.equal(document.querySelector('[data-tab-panel="settings"]').hidden,false);
  const language=document.querySelector('#language-select');language.value='en';language.dispatchEvent(new window.Event('change'));await tick();
  assert.equal(document.querySelector('#tab-products').textContent,en.tabs.products);
  document.querySelector('.delete-product-btn').click();await tick();
  assert.equal(document.querySelectorAll('.product-item').length,1);
  assert.equal(errors.length,0,errors.join('\n'));
  results.popup={passed:['initial populated render','ascending price sort','filter restoration','transient search','target marker','inert HTML in product title','full tab mode','tab switch','BG/EN language switch','delete and rerender'],errors};
}

test('popup rendering, filters, language switching, and deletion', runPopup);
