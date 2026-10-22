import {memo} from 'react';
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';
import {compactNumber,number,time,type Snapshot} from './types';
const tooltipStyle={background:'#101a24',border:'1px solid #304152',borderRadius:3,color:'#dce7f4',fontSize:11};

export default memo(function Dynamics({rows}:{rows:Snapshot['heartbeat']|undefined}){
 return <section className="panel dynamics"><div className="section-heading"><div><h2>Announcement / withdrawal</h2><p>Prefix operations · last 60 seconds</p></div></div><div className="legend"><span><i className="dot"/> Announcements</span><span><i className="dot orange-dot"/> Withdrawals</span></div>
 <div className="bar-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows??[]} margin={{left:0,right:12,top:10}} accessibilityLayer>
 <CartesianGrid stroke="#1b2936" vertical={false} strokeDasharray="3 6"/><XAxis dataKey="timestamp" tickFormatter={time} minTickGap={45} tick={{fill:'#8199aa',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tickFormatter={compactNumber} width={44} tick={{fill:'#8199aa',fontSize:10}} axisLine={false} tickLine={false}/>
 <Tooltip contentStyle={tooltipStyle} labelFormatter={v=>`${time(Number(v))} · local time`} formatter={(value,name)=>[`${number(Number(value))} prefix operations`,name==='announcements'?'Announcements':'Withdrawals']}/>
 <Bar dataKey="announcements" stackId="ops" fill="#50bca5" isAnimationActive={false}/><Bar dataKey="withdrawals" stackId="ops" fill="#dc9466" isAnimationActive={false}/></BarChart></ResponsiveContainer></div></section>;
});
