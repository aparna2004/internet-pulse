import {memo,useState} from 'react';
import {modelKeys,modelNames,type Evaluation} from './forecastExperiment';
const colors={random_forest:'#64d5b4',hist_gradient_boosting:'#8eb9f0',baseline:'#e2ad76'};
const format=(v:number,digits=1)=>v.toLocaleString(undefined,{maximumFractionDigits:digits});
export default memo(function ForecastScores({report}:{report:Evaluation}){
 const [metric,setMetric]=useState<'mae'|'rmse'>('mae');
 const maximum=Math.max(1,...modelKeys.map(k=>report.scores[k][metric])),minimum=Math.min(...modelKeys.map(k=>report.scores[k][metric]));
 const baseline=report.scores.baseline[metric];
 return <div className="forecast-score-visual">
  <div className="score-heading"><div><h3>Which forecast has the lowest error?</h3><p>Same later holdout windows · UPDATEs / {report.horizon_seconds}s · lower is better</p></div><div className="segmented" aria-label="Error metric">{(['mae','rmse'] as const).map(m=><button key={m} className={metric===m?'active':''} aria-pressed={metric===m} onClick={()=>setMetric(m)}>{m.toUpperCase()}</button>)}</div></div>
  <div className="score-bars">{modelKeys.map(key=>{const score=report.scores[key][metric],gain=baseline?100*(baseline-score)/baseline:null;return <div className="score-row" key={key}><div className="score-label"><span>{modelNames[key]} {score===minimum&&<small>LOWEST {metric.toUpperCase()}</small>}</span><strong>{format(score)}</strong></div><div className="score-track" role="meter" aria-label={modelNames[key]+' '+metric.toUpperCase()} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={score}><div style={{width:score/maximum*100+'%',background:colors[key]}}/></div><p>{key==='baseline'?'Reference: repeat the previous complete window':gain===null?'Baseline error is zero; percentage comparison unavailable':Math.abs(gain).toFixed(1)+'% '+(gain>=0?'lower':'higher')+' error than baseline'}</p></div>})}</div>
  <div className="model-runtime">{modelKeys.filter(k=>k!=='baseline').map(key=>{const score=report.scores[key];return <div key={key}><h4 style={{color:colors[key]}}>{modelNames[key]}</h4><dl><div><dt>Evaluation fit</dt><dd>{format(score.train_seconds,2)} s</dd></div><div><dt>Inference / row</dt><dd>{format(score.inference_ms_per_row,3)} ms</dd></div><div><dt>Model size</dt><dd>{format(score.model_bytes/1024)} KiB</dd></div></dl></div>})}</div>
 </div>;
});
