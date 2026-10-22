export type ModelKey='random_forest'|'hist_gradient_boosting'|'baseline';
export type Scores={mae:number;rmse:number;train_seconds?:number;inference_ms_per_row?:number;model_bytes?:number};
export type HoldoutScores=Scores&{train_seconds:number;inference_ms_per_row:number;model_bytes:number};
export type Evaluation={
 version:string;dataset_sha256:string;target:string;horizon_seconds:number;created_at:number;preliminary:boolean;
 samples:number;train_samples:number;test_samples:number;train_start:number;train_end:number;test_start:number;test_end:number;
 embargo_seconds:number;split:string;live_fit_samples:number;live_fit_label_end:number;feature_names:string[];
 versions:Record<string,string>;parameters:Record<string,Record<string,unknown>>;scores:Record<ModelKey,HoldoutScores>;insight:string;
 data_source?:string;aggregation?:string;feature_history_windows?:number;dataset_start?:number;dataset_end?:number;
};
export type Forecast={origin:number;target_end:number;generated_at:number;version:string;predictions:Record<ModelKey,number>;actual:number|null;outcome:string};
export type Capture={first_window:number|null;last_window_end:number|null;captured_windows:number;valid_windows:number;excluded_windows:number};
export type ForecastState={
 status:string;error:string|null;scope:string;eligible_examples:number;minimum_examples:number;valid_windows:number;
 excluded_windows:number;report:Evaluation|null;forecasts:Forecast[];forecast_history?:Forecast[];capture?:Capture;
 horizon_seconds:number;updated_at:number;prospective:{samples:number;scores:Record<ModelKey,Scores>|null};
};
export const modelNames:Record<ModelKey,string>={random_forest:'Random Forest',hist_gradient_boosting:'Histogram Gradient Boosting',baseline:'Repeat previous window'};
export const modelKeys:ModelKey[]=['random_forest','hist_gradient_boosting','baseline'];
export type ChartRow={
 timestamp:number;actual:number|null;random_forest:number|null;hist_gradient_boosting:number|null;baseline:number|null;
 version:string|null;generated_at:number|null;target_end:number;outcome:string;
};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

// Empty slots break lines; a genuinely observed zero remains zero.
export function makeForecastChartRows(history:Forecast[],horizon=5,maxPoints=60):ChartRow[]{
 if(!Number.isInteger(horizon)||horizon<=0)throw new Error('Invalid forecast horizon');
 const count=Math.max(1,Math.min(60,Math.floor(maxPoints))),byOrigin=new Map<number,Forecast>();
 for(const f of history){
  if(!Number.isInteger(f.origin)||f.origin%horizon!==0)continue;
  const previous=byOrigin.get(f.origin);
  if(!previous||f.generated_at>previous.generated_at)byOrigin.set(f.origin,f);
 }
 const origins=[...byOrigin.keys()];
 if(!origins.length)return [];
 const end=Math.max(...origins),start=Math.max(Math.min(...origins),end-(count-1)*horizon),rows:ChartRow[]=[];
 for(let timestamp=start;timestamp<=end;timestamp+=horizon){
  const f=byOrigin.get(timestamp);
  rows.push({
   timestamp,target_end:f?.target_end??timestamp+horizon,version:f?.version??null,generated_at:f?.generated_at??null,
   outcome:f?.outcome??'missing',actual:f?.outcome==='observed'&&finite(f.actual)?f.actual:null,
   random_forest:finite(f?.predictions.random_forest)?f!.predictions.random_forest:null,
   hist_gradient_boosting:finite(f?.predictions.hist_gradient_boosting)?f!.predictions.hist_gradient_boosting:null,
   baseline:finite(f?.predictions.baseline)?f!.predictions.baseline:null,
  });
 }
 return rows;
}

export function buildExperimentSnapshot(data:ForecastState,exportedAt=new Date().toISOString()){
 if(!data.report)throw new Error('No completed evaluation is available');
 return JSON.parse(JSON.stringify({
  export_schema_version:1,exported_at:exportedAt,snapshot_generated_at:data.updated_at,scope:data.scope,
  evaluation:data.report,capture:data.capture??null,
  baseline_definition:'Repeat the previous complete '+data.report.horizon_seconds+'-second UPDATE count.',
  prospective:{model_version:data.report.version,...data.prospective},
  forecast_history:[...(data.forecast_history??data.forecasts)].sort((a,b)=>b.origin-a.origin).slice(0,60),
 })) as {
  export_schema_version:number;exported_at:string;snapshot_generated_at:number;scope:string;evaluation:Evaluation;
  capture:Capture|null;baseline_definition:string;prospective:{model_version:string;samples:number;scores:Record<ModelKey,Scores>|null};forecast_history:Forecast[];
 };
}
export type ExperimentSnapshot=ReturnType<typeof buildExperimentSnapshot>;
const escapeHTML=(value:unknown)=>String(value??'Not recorded').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const iso=(value:number|null|undefined)=>finite(value)?new Date(value*1000).toISOString():'Not recorded';
const format=(value:unknown,digits=2)=>finite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits}):'—';
const pair=(label:string,value:unknown)=>'<dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(value)+'</dd>';

export function renderExperimentHTML(snapshot:ExperimentSnapshot){
 const r=snapshot.evaluation,e=escapeHTML,h=r.horizon_seconds;
 const metricRows=modelKeys.map(key=>{
  const s=r.scores[key];
  return '<tr><th scope="row">'+e(modelNames[key])+'</th><td>'+format(s?.mae)+'</td><td>'+format(s?.rmse)+'</td><td>'+
   (key==='baseline'?'—':format(s?.train_seconds,3))+'</td><td>'+
   (key==='baseline'?'—':format(s?.inference_ms_per_row,3))+'</td><td>'+
   (key==='baseline'?'—':format((s?.model_bytes??0)/1024,1))+'</td></tr>';
 }).join('');
 const prospectiveRows=snapshot.prospective.scores?modelKeys.map(key=>{
  const s=snapshot.prospective.scores![key];
  return '<tr><th scope="row">'+e(modelNames[key])+'</th><td>'+format(s.mae)+'</td><td>'+format(s.rmse)+'</td></tr>';
 }).join(''):'';
 const observationRows=snapshot.forecast_history.slice(0,30).map(f=>'<tr><td>'+e(iso(f.origin))+'</td><td>'+e(f.version)+'</td><td>'+
  modelKeys.map(key=>format(f.predictions[key])).join('</td><td>')+'</td><td>'+
  (f.outcome==='observed'&&finite(f.actual)?format(f.actual):f.outcome==='pending'?'Pending':'Excluded')+
  '</td><td>'+e(f.outcome)+'</td></tr>').join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<title>Internet Pulse — Forecasting Experiment '+e(r.version)+'</title><style>'+
 'body{font:14px/1.55 system-ui,Arial,sans-serif;color:#183043;background:#f3f6f8;margin:0}main{max-width:1100px;margin:24px auto;padding:28px;background:white}h1{margin:0;font-size:26px}h2{font-size:18px;margin:25px 0 9px}p{margin:8px 0}small,.muted{color:#506578}.notice{padding:12px;border:1px solid #c39b43;background:#fff8df}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}dl{margin:0}dt{font-weight:600;margin-top:8px}dd{margin:2px 0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;border:1px solid #cfdae1;padding:7px;overflow-wrap:anywhere}thead{background:#eaf1f5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f7;padding:12px;font-size:11px}.scroll{overflow-x:auto}code{overflow-wrap:anywhere}li{margin:5px 0}@media(max-width:700px){main{margin:0;padding:16px}.grid{grid-template-columns:1fr}}@media print{body{background:white}main{margin:0;padding:0;max-width:none}table{font-size:10px}tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}a{color:inherit}}@page{size:A4 landscape;margin:14mm}'+
 '</style></head><body><main><h1>Internet Pulse: Forecasting Experiment Report</h1><p class="muted">Frozen snapshot exported '+e(snapshot.exported_at)+
 '. All timestamps below are UTC. Open in a browser; use Print → Save as PDF if needed.</p>'+
 '<p class="notice">'+(r.preliminary?'PRELIMINARY: small live sample. These results do not establish validated accuracy.':'Experimental evaluation: a single chronological holdout does not establish generalization.')+'</p>'+
 '<h2>1. Problem and data</h2><p>Predict the observed BGP UPDATE count in the next aligned '+e(h)+'-second window. Both regressors and the repeat-previous-window baseline use the same evaluation targets.</p>'+
 '<div class="grid"><dl>'+pair('Data source',r.data_source??'RIPE RIS Live (configured pipeline source)')+pair('Scope',snapshot.scope)+
 pair('Aggregation',r.aggregation??'Receipt time; aligned '+h+'-second windows')+pair('Feature context',r.feature_history_windows!==undefined?r.feature_history_windows+' preceding complete windows':'See feature definitions below')+
 pair('Model dataset range',r.dataset_start!==undefined?iso(r.dataset_start)+' to '+iso(r.dataset_end):'Not recorded in this older evaluation')+
 '</dl><dl>'+pair('Retained capture range at export',snapshot.capture?iso(snapshot.capture.first_window)+' to '+iso(snapshot.capture.last_window_end):'Not recorded in this older snapshot')+
 pair('Retained capture quality',snapshot.capture?snapshot.capture.valid_windows+' valid / '+snapshot.capture.excluded_windows+' excluded windows':'Not recorded')+
 pair('Snapshot generated',iso(snapshot.snapshot_generated_at))+pair('Evaluation recorded',iso(r.created_at))+'</dl></div>'+
 '<p>Dashboard collector/ASN/prefix filters do not change this global model dataset. Capture counts above describe retained history at export, not the exact training subset.</p>'+
 '<h2>2. Training and temporal evaluation</h2><div class="grid"><dl>'+
 pair('Eligible labelled examples',r.samples)+pair('Evaluation training / holdout',r.train_samples+' / '+r.test_samples)+
 pair('Training target period',iso(r.train_start)+' to '+iso(r.train_end))+pair('Holdout target period',iso(r.test_start)+' to '+iso(r.test_end))+
 '</dl><dl>'+pair('Split',r.split)+pair('Embargo',r.embargo_seconds+' seconds')+pair('Live refit',r.live_fit_samples+' past examples; label end '+iso(r.live_fit_label_end))+
 pair('Baseline',snapshot.baseline_definition)+'</dl></div>'+
 '<p>Holdout estimators are evaluated before the separate live refit. Predictions subsequently issued by refit models are evaluated against later actual observations, separately from holdout scores.</p>'+
 '<h2>3. Held-out comparison</h2><p>MAE and RMSE are UPDATE counts per '+e(h)+'-second target; lower is better. Latency is measured batch prediction time per row. Baseline time/size was not benchmarked.</p>'+
 '<div class="scroll"><table><thead><tr><th>Model</th><th>MAE</th><th>RMSE</th><th>Evaluation fit (s)</th><th>Inference/row (ms)</th><th>Model size (KiB)</th></tr></thead><tbody>'+metricRows+
 '</tbody></table></div><p>'+e(r.insight)+'</p>'+
 '<h2>4. Prospective results</h2><p>Current evaluated model version: <code>'+e(snapshot.prospective.model_version)+'</code>. Matched complete forecasts: '+e(snapshot.prospective.samples)+
 '. These outcomes were unavailable when their forecasts were stored.</p>'+
 (prospectiveRows?'<table><thead><tr><th>Model</th><th>MAE</th><th>RMSE</th></tr></thead><tbody>'+prospectiveRows+'</tbody></table>':'<p>No matched outcomes yet; no prospective scores are claimed.</p>')+
 '<h2>5. Recent stored forecasts</h2><p>Latest '+e(Math.min(30,snapshot.forecast_history.length))+' issued records in this snapshot. Versions can change after retraining; each row identifies its version. Pending/excluded outcomes are not zeros and are not scored as observed.</p>'+
 (observationRows?'<div class="scroll"><table><thead><tr><th>Target start (UTC)</th><th>Version</th><th>Random Forest</th><th>Histogram Gradient Boosting</th><th>Baseline</th><th>Actual</th><th>Outcome</th></tr></thead><tbody>'+observationRows+'</tbody></table></div>':'<p>No prospective forecast records available.</p>')+
 '<h2>6. Input features</h2><p>Features use completed past windows only; the future target is excluded from inputs.</p><ul>'+
 r.feature_names.map(feature=>'<li><code>'+e(feature)+'</code></li>').join('')+'</ul>'+
 '<h2>7. Reproduction details</h2><dl>'+pair('Model version',r.version)+pair('Dataset SHA-256',r.dataset_sha256)+'</dl>'+
 '<h3>Fixed estimator settings</h3><pre>'+e(JSON.stringify(r.parameters,null,2))+'</pre><h3>Runtime versions</h3><pre>'+e(JSON.stringify(r.versions,null,2))+'</pre>'+
 '<p>The companion JSON download preserves numeric precision, the full evaluation object and up to 60 recent issued records. Exact retraining requires retaining the original aggregate dataset in addition to this report; the report alone is not a training dataset.</p>'+
 '<h2>8. Limitations</h2><ul><li>Early comparisons can use very few samples; neighboring windows have correlated inputs. No generalization or statistical significance is established.</li>'+
 '<li>These are collector-stream observations, not Internet-wide traffic, outage attribution or attack classification.</li>'+
 '<li>Unavailable outcomes, incomplete captures and missed forecast deadlines remain gaps. No synthetic routing observations are added.</li>'+
 '<li>Model disagreement is not a confidence interval. Performance and rankings can change with collector coverage and routing regime.</li>'+
 '<li>Free hosting can sleep or restart and reset local capture; download this report to retain the experiment snapshot.</li></ul></main></body></html>';
}
