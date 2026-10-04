// Optional real-browser regression. Set PLAYWRIGHT_MODULE to an installed module.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {setup,base,urlFor}=require('./adapters.cjs');
const {read}=require('./helpers.cjs');
const {parseHTML}=require('linkedom');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('Enter saves the target without submitting Zora or Lilly cart forms',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const [site,folder,marker] of [['zora','zora.bg html pages','regular'],['lilly','lillydrogerie.bg html pages','ELGYDIUM']]){
      const dir=path.join(base,folder),file=fs.readdirSync(dir).find(f=>f.includes(marker)&&f.endsWith('.html'));
      const html=fs.readFileSync(path.join(dir,file),'utf8'),url=urlFor(html,parseHTML(html).document);
      const s=await setup(site,html,url),product=await s.context.__adapter.extractProductData();
      await s.context.__adapter.injectWidget(product,{});
      for(const el of s.document.querySelectorAll('script,iframe,object,embed,link,style,img,source,video,audio'))el.remove();
      for(const el of s.document.querySelectorAll('*'))for(const a of [...el.attributes])if(a.name.startsWith('on'))el.removeAttribute(a.name);
      const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent(s.document.toString());
      await page.evaluate(()=>{
        window.i18n={translations:{loaded:true},loadTranslations:async()=>{},t:k=>k,getCurrentLanguage:()=> 'en'};
        window.savedTarget=null;window.submits=0;
        window.chrome={runtime:{id:'test',sendMessage:async msg=>{window.savedTarget=msg.value;return {success:true};}},storage:{local:{get:async()=>({})}}};
        document.addEventListener('submit',e=>{window.submits++;e.preventDefault();});
      });
      await page.addScriptTag({content:read('ui/price-graph-widget.js')});
      await page.addScriptTag({content:read('content/content-base.js')});
      // Test the shared loader's form relocation and the widget's Enter handler.
      await page.evaluate(async p=>{delete p.url;await window.ContentScriptBase.loadWidgetScripts(document.querySelector('#fake-discount-widget'),{...p,history:[{date:'2026-09-06',price:p.price}]},{verdict:'TRACKING',stats:{}});},product);
      await page.locator('.fake-discount-target-input').fill('80');await page.locator('.fake-discount-target-input').press('Enter');
      assert.deepEqual(await page.evaluate(()=>({submits:window.submits,target:window.savedTarget,insideForm:!!document.querySelector('#fake-discount-widget').closest('form')})),{submits:0,target:80,insideForm:false});
      await page.close();
    }
  }finally{await browser.close();}
});
