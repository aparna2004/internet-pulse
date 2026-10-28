import {memo,useMemo} from 'react';
import {milliseconds,type Snapshot} from './types';
import './routing-signals.css';
export default memo(function RoutingSignals({data}:{data:Snapshot|null}){
 const groups=useMemo(()=>{
  const grouped=new Map<string,NonNullable<Snapshot['anomalies']>>();
  for(const signal of data?.anomalies??[])grouped.set(signal.type,[...(grouped.get(signal.type)??[]),signal]);
  return [...grouped].sort((a,b)=>b[1].length-a[1].length);
 },[data?.anomalies]);
 const count=data?.anomalies.length??0;
 return <section className="panel anomaly-panel routing-signals" aria-label="Routing signals">
  <div className="section-heading"><div><h2>Routing signals</h2><p>Rule-based observations · separate from trained models</p></div><span className="badge">{count} SIGNALS</span></div>
  {count?<><div className="signal-counts" aria-label="Retained signals by type">{groups.map(([type,signals])=><div key={type}><span>{type.replace(/_/g,' ')}</span><b>{signals.length}</b></div>)}</div>
   <details className="signals-disclosure"><summary>Explore explanations <span>Expand</span></summary><div className="signals-explanations">{groups.map(([type,signals])=><details key={type} className="signal-type"><summary><span>{type.replace(/_/g,' ')}</span><b>{signals.length}</b></summary>{signals.map(signal=><article className="signal-explanation" key={signal.id}><div><time>{milliseconds(signal.timestamp)}</time><span>{signal.severity}</span></div><p>{signal.explanation}</p><small>{signal.prefix??(signal.asn?'AS'+signal.asn:'All observed routes')}{signal.collector?' · '+signal.collector.replace('.ripe.net','').toUpperCase():''}</small></article>)}</details>)}</div></details>
  </>:<p className="signals-quiet">No retained signals in this view. Quiet is a valid observation.</p>}
  <p className="signals-footnote">Counts describe retained signals, not unique incidents or a complete event rate. A signal does not establish an outage or attack.</p>
 </section>;
});
