import {useEffect,useMemo,useRef,useState} from 'react';
import ForceGraph2D, {type ForceGraphMethods} from 'react-force-graph-2d';
import {Crosshair,Network,Pause,Radio,Play} from 'lucide-react';
import type {ASNode,ASLink,TopologyData} from './types';
import {number} from './types';

const id=(n:string|ASNode)=>typeof n==='string'?n:n.id;
const edgeId=(l:ASLink)=>`${id(l.source)}:${id(l.target)}`;

export default function Topology({source,timestamp,window,onWindow,scope}:{source:TopologyData|undefined;timestamp:number;window:number;onWindow:(n:number)=>void;scope:string}){
 const container=useRef<HTMLDivElement>(null),fg=useRef<ForceGraphMethods<ASNode,ASLink>|undefined>(undefined);
 const [width,setWidth]=useState(800),[paused,setPaused]=useState(false),[selection,setSelection]=useState<string|null>(null),[hover,setHover]=useState<ASNode|null>(null);
 const [graph,setGraph]=useState<TopologyData>({nodes:[],links:[]});
 const lastRefresh=useRef(0),clock=useRef(timestamp),needsFit=useRef(true);
 useEffect(()=>{const observer=new ResizeObserver(e=>setWidth(Math.floor(e[0].contentRect.width)));if(container.current)observer.observe(container.current);return()=>observer.disconnect()},[]);
 useEffect(()=>{lastRefresh.current=0;needsFit.current=true;setSelection(null);setHover(null);setGraph({nodes:[],links:[]})},[scope]);
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
 useEffect(()=>{if(paused)fg.current?.pauseAnimation();else fg.current?.resumeAnimation()},[paused]);
 const neighbors=useMemo(()=>{const set=new Set<string>();if(selection){set.add(selection);graph.links.forEach(l=>{if(id(l.source)===selection)set.add(id(l.target));if(id(l.target)===selection)set.add(id(l.source))})}return set},[selection,graph]);
 const important=useMemo(()=>new Set([...graph.nodes].sort((a,b)=>b.updates-a.updates).slice(0,5).map(n=>n.id)),[graph]);
 const radius=(n:ASNode)=>2+Math.min(5,Math.log10(n.updates+1)*1.1);
 const freshness=(last:number)=>Math.max(.12,Math.exp(-Math.max(0,clock.current-last)/25));
 return <section className="panel topology-hero">
  <div className="hero-heading"><div><div className="eyebrow"><Network size={12}/> OBSERVED AS ADJACENCY</div><h2>The Internet, in motion<span>.</span></h2><p>Live relationships extracted from RIS AS paths</p></div><div className="graph-controls"><div className="segmented"><button className={!paused?'active':''} onClick={()=>setPaused(false)}><Radio size={12}/>Live</button><button className={paused?'active':''} onClick={()=>setPaused(true)}><Pause size={12}/>Pause</button></div><div className="segmented"><button className={window===60?'active':''} onClick={()=>onWindow(60)}>60s</button><button className={window===300?'active':''} onClick={()=>onWindow(300)}>5m</button></div><button className="icon-button" aria-label="Fit topology" onClick={()=>fg.current?.zoomToFit(600,60)}><Crosshair size={15}/></button></div></div>
  <div className="graph-stage" ref={container}>
   <div className="graph-grid"/>
   <ForceGraph2D ref={fg} width={width} height={450} graphData={graph} backgroundColor="rgba(0,0,0,0)" cooldownTicks={70} d3AlphaDecay={.04} d3VelocityDecay={.35}
    onEngineStop={()=>{if(needsFit.current&&graph.nodes.length){fg.current?.zoomToFit(700,65);needsFit.current=false}}}
    nodeLabel={()=>''} onNodeHover={n=>setHover(n??null)} onNodeClick={n=>setSelection(n.id)} onBackgroundClick={()=>setSelection(null)}
    nodeCanvasObject={(n,ctx,scale)=>{const x=n.x??0,y=n.y??0,r=radius(n);const focus=neighbors.has(n.id),dim=selection&&!focus;
     const age=Math.max(0,clock.current-n.last_seen),fresh=freshness(n.last_seen);ctx.globalAlpha=dim?.12:Math.max(.28,fresh);
     if(age<5&&!paused){const wave=(performance.now()%1600)/1600;ctx.beginPath();ctx.arc(x,y,r+wave*7,0,Math.PI*2);ctx.strokeStyle=`rgba(91,215,194,${(1-wave)*.45})`;ctx.lineWidth=.7;ctx.stroke()}
     ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=focus||hover?.id===n.id?'#c1fff0':important.has(n.id)?'#65dfc9':'#3a8d99';ctx.fill();
     if(focus||hover?.id===n.id){ctx.strokeStyle='#7af2d2';ctx.lineWidth=1/scale;ctx.stroke()}
     if((important.has(n.id)&&scale>.7)||hover?.id===n.id||n.id===selection){ctx.globalAlpha=dim?.15:.9;ctx.font=`${Math.min(12,10/scale)}px ui-monospace, monospace`;ctx.fillStyle='#b3c8d2';ctx.fillText(`AS${n.id}`,x+r+4,y+3)}ctx.globalAlpha=1;
    }}
    nodePointerAreaPaint={(n,color,ctx)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x??0,n.y??0,radius(n)+4,0,2*Math.PI);ctx.fill()}}
    linkColor={l=>{const focus=selection&&(id(l.source)===selection||id(l.target)===selection);if(selection&&!focus)return 'rgba(56,88,109,.07)';const fresh=freshness(l.last_seen);return `rgba(${focus?'137,245,215':'69,153,160'},${focus?.8:.08+fresh*.42})`}}
    linkWidth={l=>Math.min(1.8,.3+Math.log10(l.value+1)*.3)} linkDirectionalParticles={l=>!paused&&clock.current-l.last_seen<4?1:0} linkDirectionalParticleWidth={1.8} linkDirectionalParticleSpeed={.004} linkDirectionalParticleColor={()=>'#a3f1dc'}/>
   {!graph.nodes.length&&<div className="graph-empty"><Network size={26}/><span>Awaiting observed AS paths</span></div>}
   <div className="graph-stats"><div><b>{graph.nodes.length}</b><span>VISIBLE ASNs</span></div><div><b>{graph.links.length}</b><span>OBSERVED EDGES</span></div></div>
   {(hover||selection)&&<div className="node-inspector">{(()=>{const n=hover??graph.nodes.find(n=>n.id===selection);return n?<><span className="eyebrow">{hover?'HOVERED ASN':'SELECTED NEIGHBORHOOD'}</span><b>AS{n.id}</b><span>{number(n.updates)} recent updates</span><span>{n.connections} visible connections</span></>:null})()}</div>}
   <div className="graph-caption"><span><i className={paused?'dot paused-dot':'dot'}/>{paused?'SNAPSHOT PAUSED':'LIVE PATH OBSERVATIONS'}</span><span>{selection?<button onClick={()=>setSelection(null)}>Clear AS{selection} selection</button>:'Click a node to inspect neighbors · scroll to zoom'}</span></div>
  </div>
 </section>
}
