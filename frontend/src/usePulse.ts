import {useEffect,useState} from 'react';
import type {Filters,Snapshot} from './types';

export function usePulse(filters:Filters){
 const [data,setData]=useState<Snapshot|null>(null),[transport,setTransport]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let stopped=false;let socket:WebSocket;let retry:ReturnType<typeof setTimeout>;let last=0;
  setData(null);setTransport(false);setError('');
  const query=new URLSearchParams(Object.entries(filters).map(([k,v])=>[k,String(v)]));
  function open(){if(stopped)return;last=0;socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?${query}`);
   socket.onmessage=e=>{try{const value=JSON.parse(e.data) as Snapshot;if(!Array.isArray(value.heartbeat)||!value.activity)return;setData(value);setTransport(true);setError('');last=Date.now()}catch{setError('Invalid dashboard snapshot')}};
   socket.onclose=e=>{setTransport(false);if(e.code===1008||e.code===1013)setError(e.reason||'Filter unavailable. Reset filters and retry.');if(!stopped&&e.code!==1008)retry=setTimeout(open,e.code===1013?10000:2000)};
   socket.onerror=()=>socket.close();
  }open();const watchdog=setInterval(()=>{if(last&&Date.now()-last>5000){setTransport(false);socket.close()}},2000);
  return()=>{stopped=true;clearTimeout(retry);clearInterval(watchdog);socket.close()};
 },[filters.collector,filters.asn,filters.prefix,filters.window]);
 return {data,transport,error};
}
