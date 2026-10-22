import {memo,useCallback,useMemo,useRef,useState,type PointerEvent} from 'react';
import {motion,useReducedMotion} from 'framer-motion';
import {Activity} from 'lucide-react';
import type {Snapshot} from './types';
import {compactNumber,number,time} from './types';

export default memo(function Heartbeat({data}:{data:Snapshot|null}){
 const [hover,setHover]=useState<number|null>(null);const reduced=useReducedMotion();
 const previous=useRef<Snapshot['heartbeat']>([]),stamp=useRef(0),dropped=useRef<Snapshot['heartbeat'][number]|null>(null);
 const rows=data?.heartbeat??[];
 if(data&&stamp.current!==data.timestamp){dropped.current=previous.current[0]??rows[0];previous.current=rows;stamp.current=data.timestamp}
 const points=useMemo(()=>rows.length?[dropped.current??rows[0],...rows]:[],[rows]);
 const max=Math.max(100,...rows.map(r=>r.updates),data?.rolling_average??0)*1.15;
 const step=1000/59,y=(n:number)=>180-n/max*160;
 const path=useMemo(()=>points.map((p,i)=>`${i?'L':'M'}${i*step},${180-p.updates/max*160}`).join(' '),[points,max,step]);
 const hovered=hover===null?null:rows[hover];
 const inspectPoint=useCallback((e:PointerEvent<HTMLDivElement>)=>{const rect=e.currentTarget.getBoundingClientRect();setHover(Math.min(59,Math.max(0,Math.round((e.clientX-rect.left)/rect.width*59))))},[]);
 return <section className="panel heartbeat-panel"><div className="section-heading"><div><div className="eyebrow"><Activity size={12}/> INTERNET HEARTBEAT</div><h2>Routing never sleeps.</h2></div><span className="badge">60s · 1s RESOLUTION</span></div>
  <div className="rate-line"><strong>{number(data?.updates_per_second??0)}<small> updates / sec</small></strong><div>ROLLING AVG <b>{number(data?.rolling_average??0)}</b><span className="tiny muted">{data?.baseline_ready?'59-second baseline':'Baseline warming up'}</span></div></div>
  <div className="seismograph" tabIndex={0} aria-label="Inspect heartbeat: use left and right arrows for timestamps and updates per second" onBlur={()=>setHover(null)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setHover(h=>e.key==='Home'?0:e.key==='End'?59:Math.min(59,Math.max(0,(h??59)+(e.key==='ArrowLeft'?-1:1))))}}} onPointerLeave={e=>{if(e.pointerType!=='touch')setHover(null)}} onPointerMove={inspectPoint} onPointerDown={inspectPoint}>
   <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="Real observed BGP updates per second over the last 60 seconds">
    <defs><clipPath id="heartbeat-clip"><rect width="1000" height="200"/></clipPath><linearGradient id="heartbeat-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#57d9bd" stopOpacity=".13"/><stop offset="1" stopColor="#57d9bd" stopOpacity="0"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(v=><g key={v}><line x1="0" x2="1000" y1={y(max*v)} y2={y(max*v)} stroke="#1b2936" strokeDasharray="3 6"/></g>)}
    {data&&<line x1="0" x2="1000" y1={y(data.rolling_average)} y2={y(data.rolling_average)} stroke="#a1b1bd" strokeOpacity=".3" strokeDasharray="5 5"/>}
    <g clipPath="url(#heartbeat-clip)"><motion.g key={rows.at(-1)?.timestamp??0} initial={{x:reduced?-step:0}} animate={{x:-step}} transition={{duration:reduced?0:.9,ease:'linear'}}><path d={`${path} L${60*step},180 L0,180 Z`} fill="url(#heartbeat-fill)"/><path d={path} fill="none" stroke="#69dfc2" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>{points.map((p,i)=>p.spike!==null?<circle key={`${p.timestamp}-${i}`} cx={i*step} cy={y(p.updates)} r="3.5" fill="#f0ab72"/>:null)}</motion.g></g>
    {hovered&&<><line x1={hover!*step} x2={hover!*step} y1="0" y2="180" stroke="#92aebe" strokeOpacity=".5"/><circle cx={hover!*step} cy={y(hovered.updates)} r="4" fill="#d8fff1"/></>}
   </svg>
   <div className="heartbeat-axis" aria-hidden="true">{[0,.25,.5,.75,1].map(v=><span key={v} style={{top:`${y(max*v)/2}%`}}>{compactNumber(Math.round(max*v))}</span>)}</div>
   {hovered&&<div role="status" aria-live="off" className="heartbeat-tooltip" style={{left:`${Math.min(98,Math.max(2,hover!/59*100))}%`,transform:hover!>=30?'translateX(-100%)':undefined}}><b>{time(hovered.timestamp)} · local time</b><span>{number(hovered.updates)} updates/sec</span>{hovered.spike!==null&&<em>Above spike threshold</em>}</div>}
  </div>
  <div className="chart-time"><span>{rows[0]?time(rows[0].timestamp):'—'}</span><span className="heartbeat-key"><i className="dot"/> Updates <i className="dot orange-dot"/> Detected spikes</span><span>{rows.at(-1)?time(rows.at(-1)!.timestamp):'—'}</span></div>
 </section>
});
