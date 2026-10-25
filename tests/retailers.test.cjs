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
  const context=vm.createContext({window:{},document,console});vm.runInContext(read('ui/ui-kit.js'),context);vm.runInContext(read('ui/advanced-chart.js'),context);
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

const ld=data=>'<script type="application/ld+json">'+JSON.stringify(data)+'</script>';
function baseContext(location={href:'https://www.technopolis.bg/bg/x/p/1'}){
  const {document,window}=parseHTML('<html><body></body></html>');window.location=location;
  const sent=[];
  const context=vm.createContext({window,document,location,setTimeout,console:{warn(){},error(){},log(){}},
    chrome:{runtime:{id:'test',sendMessage:(req,cb)=>{sent.push(req.data);cb({success:true,product:req.data,analysis:{}});}}}});
  vm.runInContext(read('content/content-base.js'),context);
  return {base:context.window.ContentScriptBase,sent,location};
}

test('Technopolis flags JSON-LD for another product as a pending route',async()=>{
  const page=ld({'@type':'Product',sku:'513560',name:'Nokia',offers:{price:'23.90',priceCurrency:'EUR'}});
  const stale=await setup('technopolis',page,'https://www.technopolis.bg/bg/x/p/577791');
  assert.equal((await stale.context.__adapter.extractProductData()).routePending,true);
  const current=await setup('technopolis',page,'https://www.technopolis.bg/bg/x/p/513560');
  assert.equal((await current.context.__adapter.extractProductData()).routePending,false);
});

test('a pending route is re-read before tracking and never recorded when it persists',async()=>{
  const {base,sent}=baseContext();const product=(price,routePending)=>({id:'technopolis_1',url:'https://www.technopolis.bg/bg/x/p/1',price,routePending});
  let reads=0;
  await base.trackAndDisplay(async()=>++reads<3?product(23.9,true):product(29.9,false),async()=>{},()=>true);
  assert.equal(reads,3);assert.deepEqual(sent.map(p=>[p.price,'routePending' in p]),[[29.9,false]]);
  let injected=0;
  await base.trackAndDisplay(async()=>product(23.9,true),async()=>{injected++;},()=>true,{routeWaitMs:500});
  assert.equal(sent.length,1);assert.equal(injected,0);
});

test('first-load readiness keeps probing until the product page hydrates',async()=>{
  const {base}=baseContext();let probes=0,tracked=0;
  base.whenProductPage(()=>++probes>=3,()=>{tracked++;},0,5000);
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.equal(tracked,1);assert.equal(probes,3);
  const nav=baseContext();let late=0;
  nav.base.whenProductPage(()=>{nav.location.href='https://www.technopolis.bg/bg/c/1';return false;},()=>{late++;},0,5000);
  await new Promise(resolve=>setTimeout(resolve,700));assert.equal(late,0);
});

test('Notino keeps one history for a single-variant product and per-variant IDs otherwise',async()=>{
  const offer=(variant,price)=>({price,priceCurrency:'EUR',availability:'InStock',sku:'S'+variant,url:'/vs/bare/p-'+variant+'/'});
  const page=(offers,visible)=>'<div data-testid="pd-price-wrapper">'+visible+' €</div>'+ld({'@type':'Product',name:'Bare',sku:'S1',gtin13:'667548038720',offers});
  const single=await setup('notino',page([offer(1,14.32),offer(1,17.9)],'17,90'),'https://www.notino.bg/vs/bare/p-1/');
  const p=await single.context.__adapter.extractProductData();
  assert.deepEqual([p.id,p.ean,p.routePending],['notino_vs_bare','667548038720',false]);
  const multi=await setup('notino',page([offer(1,17.9),offer(2,19.9)],'19,90'),'https://www.notino.bg/vs/bare/p-2/');
  const q=await multi.context.__adapter.extractProductData();
  assert.deepEqual([q.id,q.ean,q.routePending],['notino_2',null,false]);
  // Right after a variant switch the previous variant's price is still shown.
  const switching=await setup('notino',page([offer(1,17.9),offer(2,19.9)],'17,90'),'https://www.notino.bg/vs/bare/p-2/');
  assert.equal((await switching.context.__adapter.extractProductData()).routePending,true);
});

test('ProductGroup barcodes follow the selected size and are empty without one',async()=>{
  const dir=path.join(base,'aboutyou.bg html pages');if(!fs.existsSync(dir))return;
  const html=fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(f=>f.startsWith('regular price'))),'utf8');
  const url=urlFor(html,parseHTML(html).document);
  assert.equal((await (await setup('aboutyou',html,url)).context.__adapter.extractProductData()).ean,null);
  assert.equal((await (await setup('aboutyou',html,url+'?vid=91611795')).context.__adapter.extractProductData()).ean,'0198961099840');
});

test('Obuvki and Answear thumbnails are product image URLs',async()=>{
  for(const [site,host,prefix] of [['obuvki','obuvki.bg','img.eobuwie.cloud'],['answear','answear.bg','img2.ans-media.com']]){
    const dir=path.join(base,host+' html pages');if(!fs.existsSync(dir))continue;
    for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.html'))){
      const html=fs.readFileSync(path.join(dir,f),'utf8');
      const p=await (await setup(site,html,urlFor(html,parseHTML(html).document))).context.__adapter.extractProductData();
      assert.equal(typeof p.thumbnail,'string',f);assert(p.thumbnail.startsWith('https://'+prefix+'/'),f);
    }
  }
});

// Live captures (2026-10-25; Zora saved by hand in Chrome): [site, folder, file prefix, price, originalPrice].
// price null = out of stock / not purchasable; 'not-product' = a delisted
// product URL that must not be treated as a product page at all.
const cases=[
  ['emag','emag.bg','regular price',1259.99,null],['emag','emag.bg','discounted price',1204.26,null],['emag','emag.bg','out of stock',null,null],
  ['ozone','ozone.bg','regular price',369,null],['ozone','ozone.bg','discounted price -',365,null],['ozone','ozone.bg','discounted price (RRP)',604,null],['ozone','ozone.bg','out of stock',null,null],
  ['notino','notino.bg','regular price',17.9,null],['notino','notino.bg','discounted price',41.9,null],['notino','notino.bg','out of stock',null,null],
  ['technopolis','technopolis.bg','regular price',23.9,null],['technopolis','technopolis.bg','discounted price',29.9,35.7],['technopolis','technopolis.bg','out of stock',null,null],
  ['technomarket','technomarket.bg','regular price',469,null],['technomarket','technomarket.bg','discounted price (RRP)',184.9,null],['technomarket','technomarket.bg','out of stock',null,null],
  ['ardes','ardes.bg','regular price',1035.99,null],['ardes','ardes.bg','discounted price',499.99,519.99],['ardes','ardes.bg','out of stock',null,null],
  ['plesio','plesio.bg','regular price',99,null],['plesio','plesio.bg','discounted price',59,null],['plesio','plesio.bg','out of stock','not-product'],
  ['aboutyou','aboutyou.bg','regular price',64.9,null],['aboutyou','aboutyou.bg','discounted price',117.5,279],['aboutyou','aboutyou.bg','out of stock',null],
  ['answear','answear.bg','regular price',49.99,null],['answear','answear.bg','discounted price',179.9,209.9],['answear','answear.bg','out of stock',null],
  ['decathlon','decathlon.bg','regular price',71.58,null],['decathlon','decathlon.bg','discounted price',19.99,48.56],
  ['dm','dm-drogerie.bg','regular price',4.45,null],['dm','dm-drogerie.bg','out of stock','not-product'],
  ['fashiondays','fashiondays.bg','regular price',25.99,null],['fashiondays','fashiondays.bg','discounted price (RRP)',12.99,null],
  ['fashiondays','fashiondays.bg','out of stock -',null],['fashiondays','fashiondays.bg','out of stock (price still shown)',null],
  ['lilly','lillydrogerie.bg','regular price',6.03,null],['lilly','lillydrogerie.bg','discounted price',23.99,61.35],
  ['bricolage','mr-bricolage.bg','regular price',204.51,null],['bricolage','mr-bricolage.bg','discounted price',54.99,83.99],
  ['obuvki','obuvki.bg','regular price',74.99,null],['obuvki','obuvki.bg','discounted price',38.99,null],['obuvki','obuvki.bg','out of stock',null],
  ['praktiker','praktiker.bg','regular price',168.7,null],['praktiker','praktiker.bg','out of stock',null],
  ['sopharmacy','sopharmacy.bg','regular price',1.48,null],['sopharmacy','sopharmacy.bg','discounted price',1.34,1.68],
  ['sportdepot','sportdepot.bg','regular price',159.99,null],['sportdepot','sportdepot.bg','discounted price',44.99,null],
  ['ebag','ebag.bg','regular price',7.15,null],['ebag','ebag.bg','discounted price',1.29,1.99],
  // Regular = flyer price whose hidden cc_page_data list price (783) is not shown;
  // out of stock = "изчерпан онлайн" notice while microdata still says InStock.
  ['zora','zora.bg','regular price',579,null],['zora','zora.bg','discounted price',289.99,329],['zora','zora.bg','out of stock',null,null]
];
for(const [site,host,prefix,price,original] of cases)test(`saved ${site} "${prefix}" fixture extracts correctly`,async t=>{
  const dir=path.join(base,host+' html pages');if(!fs.existsSync(dir))return t.skip('Local reference HTML not installed');
  const file=fs.readdirSync(dir).find(f=>f.startsWith(prefix)&&f.endsWith('.html'));assert(file,`missing fixture ${host}/${prefix}`);
  const html=fs.readFileSync(path.join(dir,file),'utf8');
  const url=urlFor(html,parseHTML(html).document);const s=await setup(site,html,url);
  if(price==='not-product')return assert.equal(s.context.__adapter.isProductPage(),false);
  const p=await s.context.__adapter.extractProductData();
  assert.equal(p.price,price);
  if(original!==undefined)assert.equal(p.originalPrice,original);
});
