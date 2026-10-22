// Isolated export/chart fixtures never enter production storage or the dashboard.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/forecastExperiment.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports});
const {makeForecastChartRows:rows,buildExperimentSnapshot:snapshot,renderExperimentHTML:html}=mod.exports;
const keys=['random_forest','hist_gradient_boosting','baseline'];
const forecast=(origin,actual=0,outcome='observed')=>({origin,target_end:origin+5,generated_at:origin+.2,version:'test-v1',actual,outcome,predictions:{random_forest:1.125,hist_gradient_boosting:2.25,baseline:0}});
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name)}
check('gaps are blank; observed zero survives; pending and excluded are not observations',()=>{
 const input=[forecast(20,null,'pending'),forecast(5),forecast(15,123,'excluded-incomplete')],before=JSON.stringify(input),result=rows(input);
 assert.equal(result.length,4);assert.equal(result[0].actual,0);assert.equal(result[1].outcome,'missing');
 for(const key of ['actual',...keys])assert.equal(result[1][key],null);
 assert.equal(result[2].actual,null);assert.equal(result[3].actual,null);assert.equal(result[3].random_forest,1.125);
 assert.equal(JSON.stringify(input),before);
});
check('latest sixty aligned slots, duplicate resolution and invalid values',()=>{
 const input=Array.from({length:100},(_,i)=>forecast(i*5));
 input.push({...forecast(495,99),generated_at:496});input.push(forecast(497));
 const result=rows(input);assert.equal(result.length,60);assert.equal(result[0].timestamp,200);assert.equal(result[59].actual,99);
 const bad=forecast(5);bad.predictions.random_forest=NaN;assert.equal(rows([bad])[0].random_forest,null);
 assert.throws(()=>rows([],0),/horizon/);assert.equal(rows([]).length,0);
});
const scores=Object.fromEntries(keys.map(key=>[key,{mae:1.123456,rmse:2,train_seconds:.123,inference_ms_per_row:.03,model_bytes:2048}]));
const state={status:'ready',error:null,scope:'Global observed stream',eligible_examples:8,minimum_examples:8,valid_windows:13,excluded_windows:1,horizon_seconds:5,updated_at:100,forecasts:[forecast(90)],forecast_history:[forecast(95,null,'pending'),forecast(90),forecast(85,null,'excluded-incomplete')],capture:{first_window:0,last_window_end:100,captured_windows:20,valid_windows:19,excluded_windows:1},prospective:{samples:1,scores},report:{version:'test-v1',dataset_sha256:'abc',target:'UPDATE count',horizon_seconds:5,created_at:100,preliminary:true,samples:8,train_samples:4,test_samples:3,train_start:25,train_end:45,test_start:50,test_end:65,embargo_seconds:5,split:'Chronological 70/30',live_fit_samples:8,live_fit_label_end:65,feature_names:['lag_1','<script>alert(1)</script>'],versions:{python:'3.12'},parameters:{random_forest:{random_state:42}},scores,insight:'Baseline is best <script>alert(2)</script>',data_source:'RIPE RIS Live',aggregation:'Aligned windows',feature_history_windows:5,dataset_start:0,dataset_end:65}};
check('frozen snapshot preserves precision, provenance and source state',()=>{
 const result=snapshot(state,'2026-10-22T00:00:00Z');state.report.parameters.random_forest.random_state=7;
 assert.equal(result.evaluation.parameters.random_forest.random_state,42);assert.equal(result.evaluation.scores.random_forest.mae,1.123456);
 assert.equal(result.capture.valid_windows,19);assert.equal(result.prospective.model_version,'test-v1');assert.equal(result.forecast_history[0].origin,95);
 state.report.parameters.random_forest.random_state=42;assert.throws(()=>snapshot({...state,report:null}),/No completed/);
});
check('export caps history and supports older API responses',()=>{
 const result=snapshot({...state,forecast_history:Array.from({length:90},(_,i)=>forecast(i*5))});
 assert.equal(result.forecast_history.length,60);assert.equal(result.forecast_history[0].origin,445);
 const legacy={...state};delete legacy.forecast_history;delete legacy.capture;assert.equal(snapshot(legacy).forecast_history.length,1);assert.equal(snapshot(legacy).capture,null);
});
check('standalone HTML escapes metadata and distinguishes pending, excluded and zero',()=>{
 const result=html(snapshot(state));assert.ok(result.startsWith('<!doctype html>'));assert.ok(!result.includes('<script>'));
 for(const text of ['&lt;script&gt;','PRELIMINARY','Pending','Excluded','<td>0</td>','Dataset SHA-256','RIPE RIS Live','UTC','Baseline time/size was not benchmarked','report alone is not a training dataset','random_state','Current evaluated model version:'])assert.ok(result.includes(text),text);
});
check('unmatched forecasts never claim prospective scores',()=>{
 const result=html(snapshot({...state,prospective:{samples:0,scores:null}}));assert.ok(result.includes('No matched outcomes yet; no prospective scores are claimed.'));
});
console.log(checks+' forecast experiment scenarios passed');
