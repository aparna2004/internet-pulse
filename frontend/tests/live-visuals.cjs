// Isolated fixtures only: never injected into live storage or UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),base=path.join(__dirname,'../src'),cache=new Map();
function load(name){
 if(cache.has(name))return cache.get(name);
 const mod={exports:{}};cache.set(name,mod.exports);
 const source=ts.transpileModule(fs.readFileSync(path.join(base,name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{exports:mod.exports,require:n=>n.startsWith('./')?load(n.slice(2)+'.ts'):require(n)});
 return mod.exports;
}
const {timelineGroups,mergeEventSamples}=load('eventTimelineData.ts');
const event=(id,timestamp,collector='rrc00.ripe.net',announcements=1,withdrawals=0)=>({id,timestamp,collector,announcements,withdrawals});
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name)}
check('timeline grouping conserves every real record without mutating input',()=>{
 const input=[event(1,100),event(2,100),event(3,100,'rrc00.ripe.net',0,1),event(4,101,'rrc01.ripe.net')],before=JSON.stringify(input),result=timelineGroups(input);
 assert.equal(result.groups.length,2);assert.equal(result.groups.reduce((s,g)=>s+g.events.length,0),4);
 assert.equal(result.groups[0].type,'mixed');assert.equal(result.min,100);assert.equal(result.max,101);
 assert.equal(JSON.stringify(input),before);
});
check('same-time records and empty/quiet inputs remain honest and finite',()=>{
 const result=timelineGroups([event(1,100),event(2,100,'rrc01.ripe.net',0,1)]);
 assert.equal(result.groups.length,2);assert.ok(result.groups.every(g=>Number.isFinite(g.x)&&g.x>=4&&g.x<=96));
 assert.equal(result.groups[1].type,'withdraw');assert.equal(timelineGroups([]).groups.length,0);
});
check('timeline bounds visible mark density per collector and keeps all records accessible',()=>{
 const input=Array.from({length:40},(_,i)=>event(i,100+i*.01)),result=timelineGroups(input);
 assert.ok(result.groups.length<=20);assert.equal(new Set(result.groups.flatMap(g=>g.events.map(e=>e.id))).size,40);
});
check('collector metadata is sourced, unique and within real coordinate bounds',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/geo/collectors.json'),'utf8'));
 assert.equal(d.source,'https://stat.ripe.net/data/rrc-info/data.json');assert.ok(d.collectors.length>=20);
 assert.equal(new Set(d.collectors.map(c=>c.name)).size,d.collectors.length);
 for(const c of d.collectors){assert.match(c.name,/^rrc\d\d\.ripe\.net$/);assert.ok(Math.abs(c.latitude)<=90&&Math.abs(c.longitude)<=180);assert.match(c.coordinate_source,/DNS LOC/)}
 const a=d.collectors.find(c=>c.label==='RRC00');assert.ok(a.latitude>52&&a.latitude<53&&a.longitude>4&&a.longitude<5);assert.equal(a.multihop,true);
 const svg=fs.readFileSync(path.join(__dirname,'../public/geo/world-land.svg'),'utf8');assert.ok(svg.includes('viewBox="0 0 1000 500"'));assert.ok(!svg.includes('<script'));
});
check('sampled event retention deduplicates actual records, expires old samples and stays bounded',()=>{
 const input=Array.from({length:300},(_,i)=>({...event(i,i),received_at:i}));
 const result=mergeEventSamples(input,input.slice(-10),300,60,40);
 assert.equal(result.length,40);assert.equal(result[0].id,299);assert.equal(result[39].id,260);
 assert.equal(new Set(result.map(e=>e.id)).size,40);
 assert.equal(mergeEventSamples([],[],300,60).length,0);
 assert.equal(mergeEventSamples([],[{...event(1,301),received_at:301}],300,60).length,0);
});
const scores={random_forest:{mae:20,rmse:30,train_seconds:.1,inference_ms_per_row:.001,model_bytes:1024},hist_gradient_boosting:{mae:15,rmse:25,train_seconds:.2,inference_ms_per_row:.002,model_bytes:2048},baseline:{mae:10,rmse:20,train_seconds:0,inference_ms_per_row:0,model_bytes:0}};
const Scores=load('ForecastScores.tsx').default;
check('visual comparison reports a winning baseline and worse models truthfully',()=>{
 const html=renderToStaticMarkup(React.createElement(Scores,{report:{scores,horizon_seconds:5}}));
 assert.ok(html.includes('Repeat previous window'));assert.ok(html.includes('100.0% higher error than baseline'));assert.ok(html.includes('50.0% higher error than baseline'));
 assert.equal((html.match(/role="meter"/g)||[]).length,3);assert.ok(html.includes('lower is better'));
});
check('zero-error baseline produces no invented percentage gain',()=>{
 const zero={...scores,baseline:{...scores.baseline,mae:0}};
 const html=renderToStaticMarkup(React.createElement(Scores,{report:{scores:zero,horizon_seconds:5}}));
 assert.ok(html.includes('percentage comparison unavailable'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
});
console.log(passed+' live visualization scenarios passed');
