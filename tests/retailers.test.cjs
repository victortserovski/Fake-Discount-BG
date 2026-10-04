const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom');
const {setup,root,base,urlFor}=require('./adapters.cjs');
const {read}=require('./helpers.cjs');
const vm=require('node:vm');

test('custom EAN attributes pass the generic check-digit validator',()=>{
  const {document}=parseHTML('<tm-pointandplace ean="4006381333931"></tm-pointandplace>');
  const context=vm.createContext({document});vm.runInContext(read('content/product-parser.js'),context);
  assert.equal(vm.runInContext('ProductParser.extractEAN(document)',context),'4006381333931');
  document.querySelector('[ean]').setAttribute('ean','4006381333932');
  assert.equal(vm.runInContext('ProductParser.extractEAN(document)',context),null);
});

test('chart spacing follows elapsed dates and flat-price axes have a range',()=>{
  const {document}=parseHTML('<html><body><div id="chart"></div></body></html>');
  const context=vm.createContext({window:{},document,console});vm.runInContext(read('ui/advanced-chart.js'),context);
  const chart=new context.window.AdvancedChart(document.querySelector('#chart'),{width:800,height:280,data:[{date:'2025-09-06',price:100},{date:'2026-09-05',price:120},{date:'2026-09-06',price:110}],t:k=>k});
  assert(chart._xScale(1)>chart._xScale(2)*0.99);
  const flat=new context.window.AdvancedChart(document.querySelector('#chart'),{width:800,height:280,data:[{date:'2026-09-05',price:100},{date:'2026-09-06',price:100}],t:k=>k});
  assert(flat._minPrice<100);assert(flat._maxPrice>100);
});

test('eBag ignores unavailable recommendations and honors main-product availability',async()=>{
  const url='https://www.ebag.bg/product/593550';
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'main',offers:{priceCurrency:'EUR',price:7.15,availability:'InStock'}})+'</script><div id="store-root"><article data-product-id="/product/593550"><h1>Main</h1><button>Купи</button></article><article data-product-id="/other/593554"><button>Извести ме</button></article></div>';
  const s=await setup('ebag',html,url);assert.equal((await s.context.__adapter.extractProductData()).price,7.15);
  s.document.querySelector('article button').textContent='Извести ме';
  assert.equal((await s.context.__adapter.extractProductData()).price,null);
});

test('Fashion Days labelled RRP is never a seller was-price',async()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'bag',offers:{priceCurrency:'EUR',price:52.49}})+'</script><div class="rrp-wrapper"><span class="rrp-info">ПЦД:</span><span class="rrp-price" data-rrp-price="78.99">78.99 €</span></div>';
  const s=await setup('fashiondays',html,'https://www.fashiondays.bg/p/bag-p27366644-1/');
  const p=await s.context.__adapter.extractProductData();assert.equal(p.price,52.49);assert.equal(p.originalPrice,null);
});

test('Notino refuses a JSON-LD price when visible price is absent',async()=>{
  const html='<h1>Vichy</h1><script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Vichy',offers:{priceCurrency:'EUR',price:42.5,availability:'InStock'}})+'</script>';
  const s=await setup('notino',html,'https://www.notino.bg/vichy/sunscreen/');
  assert.equal((await s.context.__adapter.extractProductData())?.price??null,null);
});

test('stale navigation response does not inject the previous product',async()=>{
  const {document,window}=parseHTML('<html><body><h1>A</h1></body></html>');
  const location={href:'https://www.ozone.bg/product/a/'};window.location=location;
  let respond;const context=vm.createContext({window,document,chrome:{runtime:{id:'test',sendMessage:(req,cb)=>{respond=cb;}}}});
  vm.runInContext(read('content/content-base.js'),context);let injected=0;
  const p={id:'ozone_a',url:location.href,price:10};
  const pending=window.ContentScriptBase.trackAndDisplay(()=>p,()=>{injected++;},()=>location.href.includes('/product/'));
  await Promise.resolve();location.href='https://www.ozone.bg/category/games/';respond({success:true,product:p,analysis:{}});await pending;
  assert.equal(injected,0);
});

test('shared widget loader relocates a target input outside retailer forms',async()=>{
  const {document,window}=parseHTML('<html><body><form><div id="widget"></div></form></body></html>');
  let parentForm=true;
  const context=vm.createContext({window,document,FakeDiscountWidget:{init:async el=>{parentForm=el.closest('form');}}});
  vm.runInContext(read('content/content-base.js'),context);
  await window.ContentScriptBase.loadWidgetScripts(document.querySelector('#widget'),{},{});
  assert.equal(parentForm,null);
});

const cases=[['ozone','ozone.bg html pages','Reanimal',29.99],['ebag','ebag.bg html pages','complete.html',7.15],['ebag','ebag.bg html pages','complete 2.html',null],['ardes','ardes.bg html pages','discounted',399.99],['fashiondays','fashiondays.bg html pages','regular price',52.49]];
for(const [site,folder,marker,price] of cases)test('saved '+site+' fixture has the corrected price',async t=>{
  const dir=path.join(base,folder);if(!fs.existsSync(dir))return t.skip('Local reference HTML not installed');
  const file=fs.readdirSync(dir).find(f=>f.includes(marker)&&f.endsWith('.html'));const html=fs.readFileSync(path.join(dir,file),'utf8');
  const url=urlFor(html,parseHTML(html).document);const s=await setup(site,html,url);const p=await s.context.__adapter.extractProductData();
  assert.equal(p.price,price);if(site==='fashiondays')assert.equal(p.originalPrice,null);
  if(site==='ardes')assert.equal(p.originalPrice,526.99);
});
