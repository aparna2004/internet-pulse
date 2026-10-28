import {memo,useMemo,useState} from 'react';
import {collectorName,milliseconds,number,type BGPEvent} from './types';
import {timelineGroups} from './eventTimelineData';
import './waterfall.css';

export default memo(function EventTimeline({events}:{events:BGPEvent[]}){
 const [selected,setSelected]=useState<string|null>(null),[record,setRecord]=useState<number|null>(null);
 const {groups,min,max}=useMemo(()=>timelineGroups(events),[events]);
 const collectors=[...new Set(events.map(e=>e.collector))].sort();
 const group=groups.find(g=>g.key===selected);
 const picked=group?.events.find(e=>e.id===record)??group?.events[0]??events[0];
 const announced=events.reduce((sum,e)=>sum+e.announcements,0),withdrawn=events.reduce((sum,e)=>sum+e.withdrawals,0),operations=announced+withdrawn;
 const peak=Math.max(1,...groups.map(g=>g.events.length));
 const kind=(e:BGPEvent)=>e.announcements&&e.withdrawals?'mixed':e.announcements?'announce':e.withdrawals?'withdraw':'update';
 return <div className="event-raster waterfall-visual">
  <div className="waterfall-summary" aria-label="Visible sampled event statistics">
   <div><span>SAMPLED UPDATES</span><strong>{number(events.length)}</strong><small>Retained in this view</small></div>
   <div><span>COLLECTORS</span><strong>{collectors.length.toString().padStart(2,'0')}</strong><small>In the visible sample</small></div>
   <div className="summary-announce"><span>ANNOUNCED PREFIXES</span><strong>{number(announced)}</strong><small>Operations in sample</small></div>
   <div className="summary-withdraw"><span>WITHDRAWN PREFIXES</span><strong>{number(withdrawn)}</strong><small>Operations in sample</small></div>
  </div>
  <div className="waterfall-operation-strip" aria-label={announced+' announced and '+withdrawn+' withdrawn prefix operations in the sample'}><span style={{width:operations?announced/operations*100+'%':'0%'}}/><span style={{width:operations?withdrawn/operations*100+'%':'0%'}}/></div>
  <div className="waterfall-chart-heading"><div><h3>Observation timeline</h3><p>Collector lanes · older → newer · local time</p></div><div className="raster-key"><span><i className="announce"/>Announce</span><span><i className="withdraw"/>Withdraw</span><span><i className="mixed"/>Mixed</span></div></div>
  {events.length?<><div className="raster-scroll"><div className="raster-plot" role="group" aria-label="Event timeline by collector">
   {collectors.map(c=>{const count=events.filter(e=>e.collector===c).length;return <div className="raster-lane" key={c}><span><i/>{collectorName(c)}<small>{count} records</small></span><div>{groups.filter(g=>g.collector===c).map(g=><button key={g.key} className={'raster-mark '+g.type+(g.key===group?.key?' selected':'')} style={{left:g.x+'%',height:18+Math.sqrt(g.events.length/peak)*14,top:11}} aria-label={collectorName(c)+' '+milliseconds(g.start)+' '+g.type+' '+g.events.length+' event records'} aria-pressed={g.key===group?.key} onClick={()=>{setSelected(g.key);setRecord(null)}} title={milliseconds(g.start)+' – '+milliseconds(g.end)+' · '+g.events.length+' records · '+g.type}><span>{g.events.length>1?g.events.length:'·'}</span></button>)}</div></div>})}
   <div className="raster-axis"><span>{milliseconds(min)}</span><span>20 time bins · grouped sampled records</span><span>{milliseconds(max)}</span></div>
  </div></div>
  <p className="waterfall-sample-note">Mark height reflects grouped record count. Select a mark to inspect. This is a bounded sample of received UPDATEs, not the full stream rate.</p>
  {picked&&<div className={'waterfall-inspector '+kind(picked)}>
   <div className="waterfall-inspector-heading"><span className="eyebrow">{group?'SELECTED RECORD':'LATEST SAMPLED RECORD'}</span>{group?<button onClick={()=>{setSelected(null);setRecord(null)}} aria-label="Clear selected event">Clear selection ×</button>:<span className="waterfall-latest">MOST RECENT</span>}</div>
   <div className="waterfall-record-meta"><span className={'event-tag '+kind(picked)}>{kind(picked).toUpperCase()}</span><b>{collectorName(picked.collector)}</b><time>{milliseconds(picked.timestamp)}</time></div>
   {group&&group.events.length>1&&<label className="raster-record">Grouped record <select aria-label="Grouped event record" value={picked.id} onChange={e=>setRecord(Number(e.target.value))}>{group.events.map((e,i)=><option key={e.id} value={e.id}>{i+1}/{group.events.length} · {e.prefixes[0]??'No prefix'}</option>)}</select></label>}
   <div className="waterfall-prefix"><small>PREFIX OPERATIONS</small><strong>{picked.prefixes.join(', ')||'No prefix operation'}</strong></div>
   <div className="waterfall-record-counts"><span>Peer <b>AS{picked.peer_asn}</b></span><span className="announce">↑ {picked.announcements} announced</span><span className="withdraw">↓ {picked.withdrawals} withdrawn</span></div>
   <div className="waterfall-path-label"><span>OBSERVED AS PATH</span><small>{picked.path.length} reported segments</small></div>
   <div className="waterfall-path" aria-label="Observed AS path">{picked.path.length?picked.path.map((asn,i)=><span key={i}>{Array.isArray(asn)?'{'+asn.join(', ')+'}':asn}</span>):<small>Not reported for this UPDATE</small>}</div>
  </div>}
  </>:<div className="waterfall-empty"><span>⌁</span><strong>No matching event samples</strong><p>New observations appear here as they arrive. Try clearing search or switching the operation filter.</p></div>}
 </div>;
});
