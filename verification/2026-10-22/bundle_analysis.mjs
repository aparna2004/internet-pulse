import {build} from 'file:///C:/Users/hp/Documents/ChatGPT/Internet%20Pulse%203/frontend/node_modules/vite/dist/node/index.js';
import {writeFileSync} from 'node:fs';
await build({
 root:'C:/Users/hp/Documents/ChatGPT/Internet Pulse 3/frontend',
 build:{write:false},
 plugins:[{
  name:'local-size-analysis',
  generateBundle(_,bundle){
   const packages={};const modules=[];
   for(const chunk of Object.values(bundle)){
    if(chunk.type!=='chunk')continue;
    for(const [id,m] of Object.entries(chunk.modules)){
     const normalized=id.replaceAll('\\','/');
     const tail=normalized.split('/node_modules/').pop();
     const name=normalized.includes('/node_modules/')?(tail.startsWith('@')?tail.split('/').slice(0,2).join('/'):tail.split('/')[0]):'application';
     packages[name]=(packages[name]||0)+m.renderedLength;
     modules.push({id,bytes:m.renderedLength});
    }
   }
   const result={note:'Rollup renderedLength before final minification; attribution estimate, not compressed transfer size.',packages:Object.entries(packages).sort((a,b)=>b[1]-a[1]),largestModules:modules.sort((a,b)=>b.bytes-a.bytes).slice(0,25)};
   writeFileSync('C:/Users/hp/Documents/ChatGPT/Internet Pulse 4/bundle-analysis.json',JSON.stringify(result,null,2));
   console.log(JSON.stringify(result.packages.slice(0,20)));
  }
 }]
});
