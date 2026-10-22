import {useEffect,useState} from 'react';
import type {Filters,Snapshot} from './types';
import {snapshotState,type ConnectionState} from './connectionState';

export function usePulse(filters:Filters){
 const [data,setData]=useState<Snapshot|null>(null),[transport,setTransport]=useState(false),[error,setError]=useState('');
 const [connection,setConnection]=useState<ConnectionState>('reconnecting'),[lastSnapshotAt,setLastSnapshotAt]=useState<number|null>(null);
 useEffect(()=>{
  let stopped=false;let socket:WebSocket|undefined;let retry:ReturnType<typeof setTimeout>|undefined;let last=0;let upstream=false;
  setData(null);setTransport(false);setError('');setConnection('reconnecting');setLastSnapshotAt(null);
  const query=new URLSearchParams(Object.entries(filters).map(([k,v])=>[k,String(v)]));
  function open(){if(stopped)return;last=0;setConnection('reconnecting');socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?${query}`);
   const current=socket;
   current.onmessage=e=>{if(stopped||current!==socket)return;try{const value=JSON.parse(e.data) as Snapshot;if(!Array.isArray(value.heartbeat)||!value.activity)return;last=Date.now();upstream=value.connected;setData(value);setTransport(true);setError('');setLastSnapshotAt(last);setConnection(snapshotState(upstream,0))}catch{setError('Invalid dashboard snapshot')}};
   current.onclose=e=>{if(stopped||current!==socket)return;setTransport(false);setConnection(e.code===1008?'disconnected':'reconnecting');if(e.code===1008||e.code===1013)setError(e.reason||'Filter unavailable. Reset filters and retry.');if(e.code!==1008)retry=setTimeout(open,e.code===1013?10000:2000)};
   current.onerror=()=>current.close();
  }
  open();
  const watchdog=setInterval(()=>{
   if(last&&socket?.readyState===WebSocket.OPEN){const age=Date.now()-last;setConnection(snapshotState(upstream,age));if(age>20000)socket.close()}
  },1000);
  return()=>{stopped=true;clearTimeout(retry);clearInterval(watchdog);socket?.close()};
 },[filters.collector,filters.asn,filters.prefix,filters.window]);
 return {data,transport,error,connection,lastSnapshotAt};
}
