import {memo,useEffect,useState} from 'react';

import ForecastHistory from './ForecastHistory';
import ForecastScores from './ForecastScores';
import {modelNames as names,modelKeys as keys,buildExperimentSnapshot,renderExperimentHTML,type ForecastState as State} from './forecastExperiment';

function saveExperiment(data:State,format:'html'|'json'){
 const snapshot=buildExperimentSnapshot(data);
 const blob=new Blob([format==='html'?renderExperimentHTML(snapshot):JSON.stringify(snapshot,null,2)],{type:format==='html'?'text/html;charset=utf-8':'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='internet-pulse-experiment-'+snapshot.evaluation.version+'.'+format;
 link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const num=new Intl.NumberFormat(undefined,{maximumFractionDigits:0});
const date=(v:number)=>new Date(v*1000).toLocaleString();

export default memo(function ForecastComparison(){
 const [data,setData]=useState<State|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;let controller:AbortController;
  const poll=async()=>{controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),4000);try{const response=await fetch('/api/forecast',{signal:controller.signal});if(!response.ok)throw Error('Forecast service unavailable');const result=await response.json() as State;if(active){setData(result);setError('')}}catch{if(active)setError('Forecast service temporarily unavailable. Routing observations continue.')}finally{clearTimeout(timeout);if(active)timer=setTimeout(poll,5000)}};
  void poll();return()=>{active=false;controller?.abort();clearTimeout(timer)};
 },[]);
 const report=data?.report,latest=data?.forecasts[0];
 return <section className="panel forecast-panel" id="forecast-insights" aria-label="Routing forecast model comparison">
  <div className="section-heading"><div><h2>Routing forecast comparison</h2><p>Two models, one target: observed UPDATE count in the next 5 seconds</p></div><span className="badge">GLOBAL · {report?.preliminary?'PRELIMINARY':data?.status.toUpperCase()??'LOADING'}</span></div>
  <p className="forecast-note">Random Forest and Histogram Gradient Boosting use the same inputs and target, compared with a repeat-previous-window baseline. Uses all observed RIS traffic; dashboard filters do not apply. Forecasts describe this collector stream, not the entire Internet.</p>
  {(error||data?.error)&&<div className="notice" role="status">{error||data?.error}</div>}
  {!report&&<div className="forecast-warmup"><strong>{data?`${data.eligible_examples} / ${data.minimum_examples} eligible training windows`:'Connecting to forecast history…'}</strong><p>{data?.status==='training'?'Training both models in a separate worker…':'Learning from arriving traffic. First comparison takes about 65–70 seconds from a fresh connection, then refreshes as new observations arrive.'}</p>{data&&<><progress aria-label="Training history collected" max={data.minimum_examples} value={Math.min(data.eligible_examples,data.minimum_examples)}/><p>{data.valid_windows} complete 5-second windows · {data.excluded_windows} incomplete 5-second windows excluded. Upstream outages and startup partial windows are excluded; connected quiet windows can be zero.</p></>}</div>}
  {report&&<><div className="forecast-summary"><strong>{report.insight}</strong>{report.preliminary&&<p role="status">PRELIMINARY · Learning from a small live sample. These early errors are not validated accuracy; rankings may change quickly.</p>}<p>{report.train_samples} training windows · {report.test_samples} later holdout windows · 5-second embargo · fixed settings · no shuffled split.</p><p>Holdout: {date(report.test_start)} – {date(report.test_end)} (local). Errors are UPDATE counts per 5-second window; lower is better. Latency is measured batch inference time per row.</p>{data?.status==='training'&&<p>Refreshing models; showing the last completed evaluation.</p>}</div>
   <ForecastScores report={report}/>
   <p className="forecast-note">Evaluation recorded {date(report.created_at)}. Live models are then refit on all {report.samples} available past windows. A single holdout cannot establish reliability across routing regimes. <a href="/api/forecast/report" target="_blank" rel="noreferrer">Open reproducible evaluation JSON</a></p>
   <div className="forecast-report-actions"><button onClick={()=>saveExperiment(data!,'html')}>Download experiment report</button><button onClick={()=>saveExperiment(data!,'json')}>Download JSON snapshot</button><span>Self-contained HTML · open and print to PDF · captured results, features and settings</span></div>
  </>}
  {data&&<ForecastHistory forecasts={data.forecast_history??data.forecasts} horizon={data.horizon_seconds??5}/>}
  {latest&&<div className="forecast-live"><strong>{latest.target_end>Date.now()/1000?'Current forecast':'Most recent forecast'} · {date(latest.origin)} – {new Date(latest.target_end*1000).toLocaleTimeString()}</strong><p>Generated {date(latest.generated_at)} · forecast version {latest.version}. {latest.outcome==='pending'?'Actual count pending target completion.':latest.outcome==='observed'?`Observed: ${num.format(latest.actual!)} UPDATEs.`:'Target window excluded because capture was incomplete.'}</p><div className="forecast-values">{keys.map(key=><span key={key}><small>{names[key]}</small><b>{num.format(latest.predictions[key])}</b><small>UPDATEs / 5 seconds</small></span>)}</div>{Math.abs(latest.predictions.random_forest-latest.predictions.hist_gradient_boosting)>0&&<p>Model disagreement: {num.format(Math.abs(latest.predictions.random_forest-latest.predictions.hist_gradient_boosting))} UPDATEs. This is not a confidence interval.</p>}</div>}
  {data?.prospective.scores&&<p className="forecast-note">Prospective MAE over {data.prospective.samples} completed forecasts from the current model version: {keys.map(key=>`${names[key]} ${num.format(data.prospective.scores![key].mae)}`).join(' · ')}. These forecasts were stored before their target windows completed.</p>}
 </section>
});
