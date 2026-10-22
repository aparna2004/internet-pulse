import {useEffect,useRef,useState} from 'react';
import {useReducedMotion} from 'framer-motion';

const steps=[
 {target:'.filter-bar',title:'Choose your view',text:'Filter real observations by collector, network number (ASN), or exact prefix. Apply scope updates the whole dashboard.'},
 {target:'.kpis',title:'Read the headline activity',text:'These counters describe observed routing updates and prefix operations. The comparison shows the previous window.'},
 {target:'.topology-hero',title:'Explore observed network links',text:'Each dot is an ASN. Hover or select it for its organization and observed neighbors. Drag to pan, scroll to zoom, and use Fit to see the graph again.'},
 {target:'.ranking',title:'Find busy networks',text:'This ranking counts updates containing each ASN. Organization names come from RIPEstat when available.'},
 {target:'.heartbeat-panel',title:'Follow the heartbeat',text:'Each point counts real updates in one second. Hover, tap, or use arrow keys on the chart to inspect a timestamp.'},
 {target:'.dynamics',title:'Compare route operations',text:'Green bars count announcements; amber bars count withdrawals. Hover or tap a bar to see prefix-operation counts.'},
 {target:'.heatmap-panel',title:'Compare collectors',text:'Each row is a collector. Brighter cells mean more updates in that time bucket. The field scrolls horizontally on small screens.'},
 {target:'.events',title:'Inspect individual events',text:'Pause freezes this list while ingestion continues. The new-event count covers this scope before local search and type filters. Resume returns to recent events.'},
 {target:'.anomaly-panel',title:'Read routing observations',text:'These cards explain routing heuristics such as flaps and long paths. A signal is an observation, not proof of an attack.'},
];

export default function DashboardTour(){
 const [step,setStep]=useState<number|null>(null),[minimized,setMinimized]=useState(false);
 const reduced=useReducedMotion();const trigger=useRef<HTMLButtonElement>(null),card=useRef<HTMLDivElement>(null);
 const close=()=>{setStep(null);setMinimized(false);trigger.current?.focus({preventScroll:true})};
 useEffect(()=>{
  if(step===null)return;
  const target=document.querySelector(steps[step].target);
  target?.classList.add('tour-target');target?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});
  card.current?.focus({preventScroll:true});
  return()=>target?.classList.remove('tour-target');
 },[step,reduced]);
 useEffect(()=>{if(step===null)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.defaultPrevented){setStep(null);setMinimized(false);trigger.current?.focus({preventScroll:true})}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)},[step]);
 return <><button ref={trigger} className="tour-trigger" onClick={()=>{setStep(0);setMinimized(false)}} aria-expanded={step!==null} aria-label="Dashboard Tour">Dashboard Tour</button>
 {step!==null&&<div ref={card} className="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" tabIndex={-1}>
  <div className="tour-heading"><span>Dashboard Tour · {step+1}/{steps.length}</span><button onClick={close} aria-label="Exit dashboard tour">×</button></div>
  <h2 id="tour-title">{steps[step].title}</h2>
  {!minimized&&<p>{steps[step].text}</p>}
  <div className="tour-actions"><button onClick={close}>Skip tour</button><button onClick={()=>setMinimized(v=>!v)}>{minimized?'Expand':'Minimize'}</button><button disabled={step===0} onClick={()=>setStep(s=>s! - 1)}>Back</button><button className="tour-next" onClick={()=>step===steps.length-1?close():setStep(s=>s!+1)}>{step===steps.length-1?'Done':'Next'}</button></div>
 </div>}</>;
}
