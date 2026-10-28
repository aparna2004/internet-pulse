import type {BGPEvent} from './types';
export function timelineGroups(events:BGPEvent[]){
 if(!events.length)return {min:0,max:0,groups:[]};
 const min=Math.min(...events.map(e=>e.timestamp)),max=Math.max(...events.map(e=>e.timestamp));
 const bins=new Map<string,{collector:string;bin:number;events:BGPEvent[]}>();
 for(const event of events){
  const bin=max===min?10:Math.min(19,Math.floor((event.timestamp-min)/(max-min)*20)),key=event.collector+':'+bin;
  const group=bins.get(key)??{collector:event.collector,bin,events:[]};
  group.events.push(event);bins.set(key,group);
 }
 return {min,max,groups:[...bins.values()].map(g=>{
  const announcements=g.events.some(e=>e.announcements>0),withdrawals=g.events.some(e=>e.withdrawals>0);
  return {...g,key:g.collector+':'+Math.min(...g.events.map(e=>e.timestamp)),x:4+g.bin/19*92,
   type:announcements&&withdrawals?'mixed':announcements?'announce':withdrawals?'withdraw':'update',
   start:Math.min(...g.events.map(e=>e.timestamp)),end:Math.max(...g.events.map(e=>e.timestamp))};
 })};
}

// Retain only actual sampled records received by this browser, never synthesize
// marks between snapshots. This is a sampled timeline, not firehose storage.
export function mergeEventSamples(previous:BGPEvent[],incoming:BGPEvent[],now:number,window:number,limit=240){
 const records=new Map<string,BGPEvent>();
 for(const event of [...previous,...incoming]){
  if(event.received_at>now-window&&event.received_at<=now)
   records.set(event.id+':'+event.received_at,event);
 }
 return [...records.values()].sort((a,b)=>b.received_at-a.received_at||b.id-a.id).slice(0,limit);
}
