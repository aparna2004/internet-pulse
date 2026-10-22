import {memo,useEffect,useMemo,useRef,useState} from 'react';
import ForceGraph2D, {type ForceGraphMethods} from 'react-force-graph-2d';
import {useReducedMotion} from 'framer-motion';
import {Crosshair,Network,Pause,Radio} from 'lucide-react';
import type {ASNode,ASLink,TopologyData} from './types';
import {number} from './types';
import {useASNOrganization} from './useASNOrganization';

const id=(n:string|ASNode)=>typeof n==='string'?n:n.id;
const edgeId=(l:ASLink)=>`${id(l.source)}:${id(l.target)}`;
const nodeRadius=(n:ASNode)=>5+Math.min(10,Math.log10(n.updates+1)*2);

export default memo(function Topology({source,timestamp,window,onWindow,scope}:{source:TopologyData|undefined;timestamp:number;window:number;onWindow:(n:number)=>void;scope:string}){
 const container=useRef<HTMLDivElement>(null),fg=useRef<ForceGraphMethods<ASNode,ASLink>|undefined>(undefined);
 const [width,setWidth]=useState(800),[paused,setPaused]=useState(false),[selection,setSelection]=useState<string|null>(null),[hover,setHover]=useState<ASNode|null>(null);
 const [graph,setGraph]=useState<TopologyData>({nodes:[],links:[]});
 const reducedMotion=useReducedMotion();
 const camera=useRef({manual:false,lastFit:0});
 const layoutStarted=useRef(0),primary=useRef(new Set<string>());
 const height=390;
 const layoutAspect=useRef(2);
 const fit=()=>{camera.current.lastFit=Date.now();fg.current?.zoomToFit(reducedMotion?0:650,Math.max(32,Math.min(width,height)*.09))};
 const lastRefresh=useRef(0),clock=useRef(timestamp),needsFit=useRef(true);
 useEffect(()=>{const observer=new ResizeObserver(e=>setWidth(Math.floor(e[0].contentRect.width)));if(container.current)observer.observe(container.current);return()=>observer.disconnect()},[]);
 useEffect(()=>{lastRefresh.current=0;needsFit.current=true;camera.current.manual=false;setSelection(null);setHover(null);setGraph({nodes:[],links:[]})},[scope]);
 useEffect(()=>{
  if(paused||!source)return;clock.current=timestamp;
  if(timestamp-lastRefresh.current<3)return;lastRefresh.current=timestamp;
  setGraph(previous=>{
   const old=new Map(previous.nodes.map(n=>[n.id,n]));
   const nodes=source.nodes.map(n=>Object.assign(old.get(n.id)??{...n},n));
   const oldLinks=new Map(previous.links.map(l=>[edgeId(l),l]));
   const links=source.links.map(l=>Object.assign(oldLinks.get(edgeId(l))??{...l},{value:l.value,last_seen:l.last_seen}));
   return {nodes,links};
  });
 },[source,timestamp,paused]);
 useEffect(()=>{
  layoutStarted.current=Date.now();
  const adjacency=new Map(graph.nodes.map(n=>[n.id,[] as string[]]));
  for(const l of graph.links){adjacency.get(id(l.source))?.push(id(l.target));adjacency.get(id(l.target))?.push(id(l.source))}
  const visited=new Set<string>();let largest=new Set<string>();
  for(const n of graph.nodes){
   if(visited.has(n.id))continue;
   const component=new Set<string>(),pending=[n.id];
   while(pending.length){const a=pending.pop()!;if(visited.has(a))continue;visited.add(a);component.add(a);pending.push(...(adjacency.get(a)??[]))}
   if(component.size>largest.size)largest=component;
  }
  primary.current=largest;
 },[graph]);
 useEffect(()=>{
  fg.current?.d3Force('charge')?.strength?.(-170);
  fg.current?.d3Force('link')?.distance?.(70);
  // Stronger gathering for satellites keeps them near the main observed component.
  // Collision separation changes positions only; no synthetic links are added.
  let nodes:ASNode[]=[];
  const gather=(alpha:number)=>{
   const aspect=layoutAspect.current,sizeScale=Math.max(.5,Math.sqrt(fg.current?.zoom()??1));
   for(const n of nodes){const strength=primary.current.has(n.id)?.018:.065;n.vx=(n.vx??0)-(n.x??0)*strength/aspect*alpha;n.vy=(n.vy??0)-(n.y??0)*strength*aspect*alpha}
   // At most 200 nodes: bounded pairwise separation, without a new dependency.
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],dx=(b.x??0)-(a.x??0),dy=(b.y??0)-(a.y??0),distance=Math.hypot(dx,dy);
    const gap=(nodeRadius(a)+nodeRadius(b)+4)/sizeScale+8;
    if(distance>=gap)continue;
    const push=(gap-distance)*.25,ux=distance?dx/distance:1,uy=distance?dy/distance:0;
    a.vx=(a.vx??0)-ux*push;a.vy=(a.vy??0)-uy*push;b.vx=(b.vx??0)+ux*push;b.vy=(b.vy??0)+uy*push;
   }
  };
  gather.initialize=(value:ASNode[])=>{nodes=value};
  fg.current?.d3Force('gather',gather);
 },[]);
 useEffect(()=>{needsFit.current=true;layoutAspect.current=Math.max(1,Math.min(2.5,width/height))},[width]);
 const adjacency=useMemo(()=>{const map=new Map(graph.nodes.map(n=>[n.id,new Set<string>()]));for(const l of graph.links){map.get(id(l.source))?.add(id(l.target));map.get(id(l.target))?.add(id(l.source))}return map},[graph]);
 const focusId=selection??hover?.id;
 // Stop simulation ticks while paused; keep canvas picking and camera controls active.
 const neighbors=useMemo(()=>new Set(focusId?[focusId,...(adjacency.get(focusId)??[])]:[]),[focusId,adjacency]);
 const important=useMemo(()=>new Set([...graph.nodes].sort((a,b)=>b.updates-a.updates).slice(0,10).map(n=>n.id)),[graph]);
 // Sample only recent observed adjacency; at most 24 edges and 30 canvas particles.
 const flow=useMemo(()=>new Map(graph.links.filter(l=>timestamp-l.last_seen<4).sort((a,b)=>b.value-a.value).slice(0,24).map((l,i)=>[edgeId(l),i<6?2:1])),[graph,timestamp]);
 const cameraCheck=useRef(0);
 const frame=(settled=false)=>{
     // Use elapsed time rather than tick count so fitting also works on slower displays.
     if(!settled&&Date.now()-layoutStarted.current<1200)return;
     if(Date.now()-cameraCheck.current<1500)return;cameraCheck.current=Date.now();
     if(!graph.nodes.length||!fg.current)return;
     if(camera.current.manual||selection||hover||paused)return;
     if(needsFit.current){fit();needsFit.current=false;return}
     if(Date.now()-camera.current.lastFit<6000)return;
     const points=graph.nodes.map(n=>fg.current!.graph2ScreenCoords(n.x??0,n.y??0));
     const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
     if(left<24||right>width-24||top<24||bottom>height-24||Math.max((right-left)/width,(bottom-top)/height)<.75)fit();
 };
 const inspected=hover??graph.nodes.find(n=>n.id===selection);
 const knownOrganization=source?.nodes.find(n=>n.id===inspected?.id)?.organization??inspected?.organization;
 const organization=useASNOrganization(inspected?.id,knownOrganization);
 const radius=(n:ASNode)=>nodeRadius(n)+(important.has(n.id)?2:0);
 const freshness=(last:number)=>Math.max(.12,Math.exp(-Math.max(0,clock.current-last)/25));
 return <section className="panel topology-hero">
  <div className="hero-heading"><div><div className="eyebrow"><Network size={12}/> OBSERVED AS ADJACENCY</div><h2>The Internet, in motion<span>.</span></h2><p>Live relationships extracted from RIS AS paths</p></div><div className="graph-controls"><div className="segmented"><button className={!paused?'active':''} onClick={()=>setPaused(false)}><Radio size={12}/>Live</button><button className={paused?'active':''} onClick={()=>setPaused(true)}><Pause size={12}/>Pause</button></div><div className="segmented"><button className={window===60?'active':''} onClick={()=>onWindow(60)}>60s</button><button className={window===300?'active':''} onClick={()=>onWindow(300)}>5m</button></div><button className="icon-button" aria-label="Fit topology" onClick={fit}><Crosshair size={15}/></button></div></div>
  <div className="graph-stage" ref={container} onPointerLeave={()=>setHover(null)} onPointerDownCapture={()=>{camera.current.manual=true}} onWheelCapture={()=>{camera.current.manual=true}}>
   <div className="graph-grid"/>
   <ForceGraph2D ref={fg} width={width} height={height} graphData={graph} backgroundColor="rgba(0,0,0,0)" cooldownTicks={paused?0:70} d3AlphaDecay={.04} d3VelocityDecay={.35}
    onNodeDrag={()=>{camera.current.manual=true}}
    onEngineTick={()=>frame()} onEngineStop={()=>frame(true)}
    nodeLabel={()=>''} onNodeHover={n=>setHover(n??null)} onNodeClick={n=>setSelection(n.id)} onBackgroundClick={()=>{setSelection(null);setHover(null)}}
    nodeCanvasObject={(n,ctx,scale)=>{const x=n.x??0,y=n.y??0,r=radius(n)/Math.max(.5,Math.sqrt(scale));const focus=neighbors.has(n.id),dim=!!focusId&&!focus;
     const age=Math.max(0,clock.current-n.last_seen),fresh=freshness(n.last_seen);ctx.globalAlpha=dim?.16:Math.max(.45,fresh);
     if(age<5&&!paused&&!reducedMotion&&important.has(n.id)){const wave=(performance.now()%1600)/1600;ctx.beginPath();ctx.arc(x,y,r+wave*7,0,Math.PI*2);ctx.strokeStyle=`rgba(91,215,194,${(1-wave)*.45})`;ctx.lineWidth=.7;ctx.stroke()}
     ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=n.id===selection?'#b5ffe6':hover?.id===n.id?'#d8fff4':focus?'#78d7c6':important.has(n.id)?'#65dfc9':'#3a8d99';ctx.fill();
     if(focus||hover?.id===n.id){ctx.strokeStyle='#7af2d2';ctx.lineWidth=1.6/scale;ctx.stroke()}
     if(important.has(n.id)||hover?.id===n.id||n.id===selection){ctx.globalAlpha=dim?.15:.95;ctx.font=`${11/scale}px ui-monospace, monospace`;ctx.lineWidth=3/scale;ctx.strokeStyle='#0d151d';ctx.strokeText(`AS${n.id}`,x+r+4/scale,y+3/scale);ctx.fillStyle='#c3d9e2';ctx.fillText(`AS${n.id}`,x+r+4/scale,y+3/scale)}ctx.globalAlpha=1;
    }}
    nodePointerAreaPaint={(n,color,ctx)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x??0,n.y??0,radius(n)/Math.max(.5,Math.sqrt(fg.current?.zoom()??1))+4,0,2*Math.PI);ctx.fill()}}
    linkColor={l=>{const focus=focusId&&(id(l.source)===focusId||id(l.target)===focusId);if(focusId&&!focus)return 'rgba(56,88,109,.09)';const fresh=freshness(l.last_seen);return `rgba(${focus?'137,245,215':'85,166,172'},${focus?.9:.18+fresh*.5})`}}
    linkWidth={l=>Math.min(2.7,.65+Math.log10(l.value+1)*.45)+(focusId&&(id(l.source)===focusId||id(l.target)===focusId)?.6:0)} linkDirectionalParticles={l=>!paused&&!reducedMotion&&clock.current-l.last_seen<4&&(!selection||id(l.source)===selection||id(l.target)===selection)?flow.get(edgeId(l))??0:0} linkDirectionalParticleWidth={2} linkDirectionalParticleSpeed={l=>.0025+Math.min(.0015,Math.log10(l.value+1)*.0003)} linkDirectionalParticleColor={()=>'#b7f5e1'}/>
   {!graph.nodes.length&&<div className="graph-empty"><Network size={26}/><span>Awaiting observed AS paths</span></div>}
   <div className="graph-stats"><div><b>{graph.nodes.length}</b><span>VISIBLE ASNs</span></div><div><b>{graph.links.length}</b><span>OBSERVED EDGES</span></div></div>
   {(hover||selection)&&<div className="node-inspector">{(()=>{const n=inspected;return n?<><span className="eyebrow">{hover?'HOVERED ASN':'SELECTED NEIGHBORHOOD'}</span><b>AS{n.id}</b>{organization&&<span className="asn-organization">{organization}</span>}<span>{number(n.updates)} recent updates</span><span>{adjacency.get(n.id)?.size??0} observed neighbors in this view</span><span className="neighbor-list" title={[...(adjacency.get(n.id)??[])].map(a=>`AS${a}`).join(', ')}>{[...(adjacency.get(n.id)??[])].slice(0,6).map(a=>`AS${a}`).join(' · ')}{(adjacency.get(n.id)?.size??0)>6?` · +${adjacency.get(n.id)!.size-6} more`:''}</span></>:null})()}</div>}
   <div className="graph-caption"><span><i className={paused?'dot paused-dot':'dot'}/>{paused?'SNAPSHOT PAUSED':'LIVE PATH OBSERVATIONS'}</span><span>{selection?<button onClick={()=>{setSelection(null);setHover(null)}}>Clear AS{selection} selection</button>:'Sampled activity (undirected) | click to inspect | scroll to zoom'}</span></div>
  </div>
 </section>
});
