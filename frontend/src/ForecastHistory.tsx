import {memo,useMemo,useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';
import {compactNumber,number,time} from './types';
import {makeForecastChartRows,modelKeys,modelNames,type Forecast,type ChartRow} from './forecastExperiment';

type SeriesKey='actual'|typeof modelKeys[number];
const seriesKeys:SeriesKey[]=['actual',...modelKeys];
const seriesNames={actual:'Actual',...modelNames};
const colors={actual:'#d8e7f1',random_forest:'#64d5b4',hist_gradient_boosting:'#8eb9f0',baseline:'#e2ad76'};
function ForecastTooltip({active,payload,visible}:{active?:boolean;payload?:Array<{payload:ChartRow}>;visible:Record<SeriesKey,boolean>}){
 const row=payload?.[0]?.payload;
 if(!active||!row)return null;
 return <div className="forecast-chart-tooltip"><strong>{time(row.timestamp)}–{time(row.target_end)} · local</strong>
  {visible.actual&&<div><span>Actual</span><b>{row.actual===null?'Not observed':number(row.actual)} UPDATEs</b></div>}
  {modelKeys.filter(key=>visible[key]).map(key=><div key={key}><span style={{color:colors[key]}}>{modelNames[key]}</span><b>{row[key]===null?'—':number(Math.round(row[key]!))} UPDATEs</b></div>)}
  <p>{row.outcome==='missing'?'No forecast was issued for this interval.':row.outcome==='pending'?'Actual count pending target completion.':row.outcome==='observed'?'Matched to a complete captured target.':'Target capture excluded; no actual count is plotted.'}</p>
  {row.version&&<small>Version {row.version}{row.generated_at!==null?' · issued '+time(row.generated_at):''}</small>}
 </div>;
}
export default memo(function ForecastHistory({forecasts,horizon=5}:{forecasts:Forecast[];horizon?:number}){
 const [visible,setVisible]=useState<Record<SeriesKey,boolean>>({actual:true,random_forest:true,hist_gradient_boosting:true,baseline:true});
 const rows=useMemo(()=>makeForecastChartRows(forecasts,horizon),[forecasts,horizon]);
 const observed=rows.filter(row=>row.actual!==null).length,issued=rows.filter(row=>row.version!==null).length,missing=rows.length-issued;
 return <div className="forecast-history" role="region" aria-label="Actual versus predicted BGP updates">
  <div className="forecast-history-heading"><div><h3>Actual vs predicted</h3><p>Up to {60*horizon/60} minutes of recent forecasts · UPDATEs / {horizon} seconds</p></div><span>{issued}/{rows.length} intervals forecast · {observed} matched</span></div>
  <div className="forecast-chart-legend" role="group" aria-label="Visible forecast series">{seriesKeys.map(key=><button type="button" key={key} aria-pressed={visible[key]} onClick={()=>setVisible(previous=>({...previous,[key]:!previous[key]}))} title={(visible[key]?'Hide ':'Show ')+seriesNames[key]}><i style={{background:colors[key]}}/>{seriesNames[key]}</button>)}</div>
  {!seriesKeys.some(key=>visible[key])&&<p className="forecast-history-note" role="status">All series hidden. Select a legend button to show a series.</p>}
  {!rows.length?<div className="empty">Waiting for the first issued forecast. Only real predictions and observed outcomes appear here.</div>:
   <div className="forecast-history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{left:0,right:12,top:12,bottom:5}} accessibilityLayer>
    <CartesianGrid stroke="#1b2936" vertical={false} strokeDasharray="3 6"/>
    <XAxis dataKey="timestamp" type="number" domain={['dataMin','dataMax']} tickFormatter={time} tickCount={5} minTickGap={35} tick={{fill:'#8199aa',fontSize:10}} axisLine={false} tickLine={false}/>
    <YAxis tickFormatter={compactNumber} width={48} domain={[0,'auto']} tick={{fill:'#8199aa',fontSize:10}} axisLine={false} tickLine={false}/>
    <Tooltip content={<ForecastTooltip visible={visible}/>}/>
    <Line name="Actual" dataKey="actual" hide={!visible.actual} stroke={colors.actual} strokeWidth={2.4} dot={{r:2,strokeWidth:0}} activeDot={{r:4}} connectNulls={false} isAnimationActive={false}/>
    <Line name={modelNames.random_forest} dataKey="random_forest" hide={!visible.random_forest} stroke={colors.random_forest} strokeWidth={1.6} dot={{r:2.5,strokeWidth:0}} activeDot={{r:3}} connectNulls={false} isAnimationActive={false}/>
    <Line name={modelNames.hist_gradient_boosting} dataKey="hist_gradient_boosting" hide={!visible.hist_gradient_boosting} stroke={colors.hist_gradient_boosting} strokeWidth={1.6} strokeDasharray="6 3" dot={{r:2.5,strokeWidth:0}} activeDot={{r:3}} connectNulls={false} isAnimationActive={false}/>
    <Line name={modelNames.baseline} dataKey="baseline" hide={!visible.baseline} stroke={colors.baseline} strokeWidth={1.4} strokeDasharray="2 4" dot={{r:2.5,strokeWidth:0}} activeDot={{r:3}} connectNulls={false} isAnimationActive={false}/>
   </LineChart></ResponsiveContainer></div>}
  <p className="forecast-history-note">{missing>0?missing+' intervals without an issued forecast in this view. ':''}Click the legend to show or hide each series. Colored dots show issued predictions for selected models, including isolated forecasts. Pending actuals and missing intervals stay blank. Hover or use the chart's arrow keys for counts, target times and model version. Lines can include successive live model versions; the holdout table above describes the latest completed evaluation.</p>
 </div>;
});
