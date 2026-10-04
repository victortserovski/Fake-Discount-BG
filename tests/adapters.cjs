const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const { parseHTML } = require(root + '/node_modules/linkedom');
const base = path.join(root, 'HTML pages and links');

const parserSource = fs.readFileSync(path.join(root,'content/product-parser.js'),'utf8');

function urlFor(html, document) {
  const saved = html.match(/saved from url=\(\d+\)(https?:[^\s<>]+)/i)?.[1];
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
  return saved || canonical || og || null;
}
async function setup(site, html, url) {
  const { document } = parseHTML(html);
  const location = new URL(url);
  const errors=[];
  const context = vm.createContext({ document, window:{location,addEventListener(){}}, location,
    URL, URLSearchParams, Node:{TEXT_NODE:3}, console: {log(){},warn(...x){errors.push(x.join(' '));},error(...x){errors.push(x.join(' '));}},
    chrome:{storage:{local:{async get(){return {};}}}},
    setTimeout(fn){queueMicrotask(fn);return 1;}, clearTimeout(){}, MutationObserver: class { observe(){} disconnect(){} },
    getComputedStyle(el){return {display:el.style.display || '', visibility:el.style.visibility || ''};},
    ContentScriptBase:{isContextValid(){return true;},createWidgetContainer(){const e=document.createElement('div');e.id='fake-discount-widget';return e;},loadWidgetCSS(){},async loadWidgetScripts(){},setupNavigation(){}}
  });
  vm.runInContext(parserSource+'\nglobalThis.ProductParser=ProductParser; ProductParser.waitForElement=async()=>null;',context);
  const source = fs.readFileSync(path.join(root,'content',site+'.js'),'utf8');
  const modified = source.replace('ContentScriptBase.setupNavigation(', 'globalThis.__adapter = {isProductPage,extractProductData,injectWidget}; return; ContentScriptBase.setupNavigation(');
  await vm.runInContext(modified,context);
  if (!context.__adapter) throw new Error('Could not expose adapter ' + site);
  return {context, document, errors};
}
module.exports={setup,root,base,urlFor};
