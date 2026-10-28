import {memo,useEffect,useMemo,useState} from 'react';
import {type Snapshot,collectorName,number} from './types';
type Collector={name:string;label:string;location:string;scope:string;multihop:boolean;latitude?:number;longitude?:number};
type Metadata={updated_at:string;collectors:Collector[]};
export default memo(function CollectorMap({data,selected,onSelect}:{data:Snapshot|null;selected:string;onSelect:(name:string)=>void}){
 const [metadata,setMetadata]=useState<Metadata|null>(null),[failed,setFailed]=useState(false),[focus,setFocus]=useState<string|null>(null),[europe,setEurope]=useState(false);
 useEffect(()=>{const controller=new AbortController();let active=true;const timer=setTimeout(()=>{controller.abort();if(active)setFailed(true)},5000);
 fetch('/geo/collectors.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then((value:Metadata)=>{if(active)setMetadata(value)}).catch(()=>{if(active)setFailed(true)}).finally(()=>clearTimeout(timer));
 return()=>{active=false;clearTimeout(timer);controller.abort()};
 },[]);
 const groups=useMemo(()=>{
  const grouped=new Map<string,Collector[]>();
  for(const c of metadata?.collectors??[]){if(c.latitude===undefined||c.longitude===undefined)continue;const key=c.location;grouped.set(key,[...(grouped.get(key)??[]),c])}
  return [...grouped].map(([location,collectors])=>({location,collectors,x:(collectors[0].longitude!+180)*1000/360,y:(90-collectors[0].latitude!)*500/180}));
 },[metadata]);
 const counts=new Map(data?.collectors.map(c=>[c.name,c.updates])??[]),total=data?.window_updates??0;
 const activity=groups.map(g=>({...g,updates:g.collectors.reduce((sum,c)=>sum+(counts.get(c.name)??0),0)}));
 const max=Math.max(1,...activity.map(g=>g.updates));
 const active=activity.find(g=>g.location===focus)??activity.find(g=>g.collectors.some(c=>c.name===selected))??[...activity].sort((a,b)=>b.updates-a.updates)[0];
 const unknown=(data?.collectors??[]).filter(c=>!metadata?.collectors.some(m=>m.name===c.name));
 return <section className="panel collector-map-panel" aria-label="Live collector geography">
  <div className="section-heading"><div><h2>Where routing is observed</h2><p>Published observation points · live activity in the selected scope</p></div><span className="badge">{data?.connected?'LIVE OBSERVATIONS':'AWAITING CONNECTION'}</span></div>
  <div className="map-toolbar"><div className="segmented"><button className={!europe?'active':''} onClick={()=>setEurope(false)}>World</button><button className={europe?'active':''} onClick={()=>setEurope(true)}>Europe detail</button></div><label>Collector <select aria-label="Map collector" value={selected} onChange={e=>onSelect(e.target.value)}><option value="">All collectors</option>{metadata?.collectors.map(c=><option value={c.name} key={c.name}>{c.label} · {c.location}</option>)}</select></label>{selected&&<button className="map-clear" onClick={()=>onSelect('')}>Clear collector</button>}</div>
  <div className="map-layout"><div className="world-map">
   <svg viewBox={europe?'440 65 190 155':'0 20 1000 430'} role="group" aria-label="Collector locations, use Tab to inspect and Enter to choose"><defs><radialGradient id="map-ocean"><stop stopColor="#122b38"/><stop offset="1" stopColor="#0a141e"/></radialGradient></defs>
    <rect x="0" y="0" width="1000" height="500" fill="url(#map-ocean)"/>
    {[60,120,180,240,300,360,420].map(y=><path key={'h'+y} d={'M0 '+y+'H1000'} className="map-grid"/>)}
    {[125,250,375,500,625,750,875].map(x=><path key={'v'+x} d={'M'+x+' 0V500'} className="map-grid"/>)}
    <image href="/geo/world-land.svg" x="0" y="0" width="1000" height="500"/>
    {activity.map(g=>{const isSelected=g.collectors.some(c=>c.name===selected),radius=3+Math.sqrt(g.updates/max)*10;return <g key={g.location} role="button" tabIndex={0} aria-label={g.location+', '+number(g.updates)+' observed updates. '+g.collectors.map(c=>c.label).join(', ')} aria-pressed={isSelected} className={'map-point '+(isSelected?'selected':'')} onMouseEnter={()=>setFocus(g.location)} onFocus={()=>setFocus(g.location)} onClick={()=>{setFocus(g.location);if(g.collectors.length===1)onSelect(g.collectors[0].name)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFocus(g.location);if(g.collectors.length===1)onSelect(g.collectors[0].name)}}}>
     <title>{g.location+' · '+g.collectors.map(c=>c.label).join(', ')+' · '+number(g.updates)+' UPDATEs'}</title>
     <circle cx={g.x} cy={g.y} r={Math.max(radius+5,10)} fill="transparent"/>
     {g.updates>0&&<circle cx={g.x} cy={g.y} r={radius+5} fill="#64d5b4" opacity=".1"/>}
     <circle cx={g.x} cy={g.y} r={radius} fill={g.updates?'#64d5b4':'#415465'} stroke={isSelected?'#f1cf8b':'#89b8bb'} strokeWidth={isSelected?2:0.7} fillOpacity={g.updates?.75:.6}/>
     <circle cx={g.x} cy={g.y} r="1.5" fill="#d9f6ed"/>
    </g>})}
   </svg><div className="map-key"><span><i/> Marker area increases with observed UPDATE count</span><span>Hover / focus to inspect · select a collector to filter</span></div>
  </div><aside className="map-inspector" aria-label="Collector location details">
   <span className="eyebrow">OBSERVATION POINT</span><h3>{active?.location??'Loading locations…'}</h3>
   <div className="map-count">{number(active?.updates??0)}<small>UPDATEs / selected {data?.window??60}s window</small></div>
   <p>{total&&active?((active.updates/total)*100).toFixed(1):'0'}% of UPDATE observations in this scope</p>
   <div className="map-location-collectors">{active?.collectors.map(c=><button key={c.name} className={selected===c.name?'selected':''} onClick={()=>onSelect(selected===c.name?'':c.name)}><span><b>{collectorName(c.name)}</b><small>{c.multihop?'MULTI-HOP · '+c.scope:c.scope}</small></span><strong>{number(counts.get(c.name)??0)}</strong></button>)}</div>
   <p className="map-disclaimer">A collector's location is a vantage point, not the origin of an event. Multi-hop collectors observe remote peers. No geographic routes are inferred.</p>
  </aside></div>
  {(!metadata||failed)&&<p className="map-source">{failed?'Location metadata unavailable; routing observations continue.':'Loading documented locations…'}</p>}
  {!!unknown.length&&metadata&&<p className="map-source">Unmapped collectors: {unknown.map(c=>collectorName(c.name)).join(', ')}. Their observations remain in the other visualizations.</p>}
  <p className="map-source">Locations: <a href="https://ris.ripe.net/docs/route-collectors/" target="_blank" rel="noreferrer">RIPE RIS / published DNS LOC</a> · land: Natural Earth (public domain) · metadata {metadata?.updated_at.slice(0,10)??'loading'}</p>
 </section>
});
