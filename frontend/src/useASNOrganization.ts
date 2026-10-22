import {useEffect,useState} from 'react';

// Only the actively hovered/selected node needs this fallback (including paused graphs).
export function useASNOrganization(asn:string|undefined, known:string|undefined){
 const [resolved,setResolved]=useState<{asn:string;name:string}|null>(null);
 useEffect(()=>{
  if(!asn||known)return;
  let stopped=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  async function resolve(){
   const timeout=setTimeout(()=>controller.abort(),5000);
   try{
    const response=await fetch(`/api/asn/${asn}`,{signal:controller.signal});
    if(!response.ok)return;
    const result=await response.json();
    if(stopped)return;
    if(result.asn===Number(asn)&&typeof result.organization==='string'&&result.organization){setResolved({asn:asn!,name:result.organization});return}
    timer=setTimeout(resolve,Math.max(2,Math.min(300,Number(result.retry_after)||300))*1000);
   }catch{/* ASN remains visible if enrichment fails. */}
   finally{clearTimeout(timeout)}
  }
  void resolve();
  return()=>{stopped=true;controller.abort();clearTimeout(timer)};
 },[asn,known]);
 return known||(resolved&&resolved.asn===asn?resolved.name:undefined);
}
