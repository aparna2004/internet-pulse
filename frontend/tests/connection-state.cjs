// Isolated transport-hook tests: no fixtures enter the running dashboard.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const path=require('node:path');const base=path.join(__dirname,'../src');
function compile(name){return ts.transpileModule(fs.readFileSync(path.join(base,name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}
const stateModule={exports:{}};
vm.runInNewContext(compile('connectionState.ts'),{exports:stateModule.exports});
const {snapshotState}=stateModule.exports;
assert.equal(snapshotState(true,0),'connected');
assert.equal(snapshotState(false,0),'disconnected');
assert.equal(snapshotState(true,8001),'stale');
assert.equal(snapshotState(false,8001),'stale');

function harness(){
 let now=100000,cursor=0,mounted=false,cleanup;const states=[],sockets=[],timeouts=new Map(),intervals=new Map();let nextTimer=1;
 const react={useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value}]},useEffect(fn){if(!mounted){mounted=true;cleanup=fn()}}};
 class FakeWebSocket{
  static OPEN=1;static CONNECTING=0;static CLOSED=3;
  constructor(){this.readyState=0;sockets.push(this)}
  snapshot(connected=true){this.readyState=1;this.onmessage?.({data:JSON.stringify({connected,heartbeat:[],activity:{},last_received:0,total_received:0})})}
  close(code=1006){if(this.readyState===3)return;this.readyState=3;this.onclose?.({code,reason:code===1008?'Invalid filter':''})}
 }
 const mod={exports:{}};
 vm.runInNewContext(compile('usePulse.ts'),{exports:mod.exports,require:name=>name==='react'?react:stateModule.exports,WebSocket:FakeWebSocket,location:{protocol:'http:',host:'localhost'},URLSearchParams,Date:{now:()=>now},setTimeout:(fn,delay)=>{const id=nextTimer++;timeouts.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timeouts.delete(id),setInterval:(fn,delay)=>{const id=nextTimer++;intervals.set(id,{fn,delay,at:now+delay});return id},clearInterval:id=>intervals.delete(id)});
 const render=()=>{cursor=0;return mod.exports.usePulse({collector:'',asn:'',prefix:'',window:60})};
 const advance=ms=>{for(let remaining=ms;remaining>0;){const step=Math.min(remaining,1000);now+=step;remaining-=step;for(const [id,t]of [...timeouts])if(t.at<=now){timeouts.delete(id);t.fn()}for(const t of intervals.values())if(t.at<=now){t.at+=t.delay;t.fn()}}};
 render();return {render,advance,sockets,cleanup:()=>cleanup(),timeouts,intervals};
}
let passed=4;
{
 const h=harness();h.sockets[0].snapshot();
 for(let i=0;i<30;i++){h.advance(1000);h.sockets[0].snapshot()}
 assert.equal(h.render().connection,'connected');assert.equal(h.render().data.total_received,0);h.cleanup();passed++;
}
{
 const h=harness();const old=h.sockets[0];old.snapshot();const last=h.render().lastSnapshotAt;h.advance(9000);
 assert.equal(h.render().connection,'stale');assert.equal(h.render().lastSnapshotAt,last);assert.ok(h.render().data);h.advance(12000);assert.equal(h.render().connection,'reconnecting');h.advance(2000);assert.equal(h.sockets.length,2);h.sockets[1].snapshot();assert.equal(h.render().connection,'connected');old.snapshot(false);assert.equal(h.render().connection,'connected');h.cleanup();passed++;
}
{
 const h=harness();h.sockets[0].snapshot(false);assert.equal(h.render().connection,'disconnected');h.sockets[0].snapshot(true);assert.equal(h.render().connection,'connected');h.sockets[0].close(1008);h.advance(30000);assert.equal(h.render().connection,'disconnected');assert.equal(h.sockets.length,1);h.cleanup();passed++;
}
{
 const h=harness();const old=h.sockets[0];h.cleanup();old.snapshot();h.advance(30000);assert.equal(h.render().lastSnapshotAt,null);assert.equal(h.sockets.length,1);assert.equal(h.intervals.size,0);passed++;
}
console.log(`${passed} frontend connection-state assertions/scenarios passed`);
