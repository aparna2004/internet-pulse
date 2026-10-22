"""Read-only live soak measurement; no generated BGP data."""
import asyncio
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import statistics
import sys
import time
from urllib.request import urlopen
from websockets.asyncio.client import connect

OUT = Path(__file__).parent / 'soak-results.jsonl'
SUMMARY = Path(__file__).parent / 'soak-summary.json'
PID = int(sys.argv[1])
DURATION = int(sys.argv[2]) if len(sys.argv)>2 else 1800

class Memory(ctypes.Structure):
    _fields_ = [('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)] + [(name,ctypes.c_size_t) for name in ['PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage']]

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.OpenProcess.argtypes = [wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
psapi = ctypes.WinDLL('psapi', use_last_error=True)
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE,ctypes.POINTER(Memory),wintypes.DWORD]
def memory():
    handle = kernel.OpenProcess(0x410,False,PID)
    if not handle: return {}
    m = Memory(); m.cb = ctypes.sizeof(m)
    ok = psapi.GetProcessMemoryInfo(handle,ctypes.byref(m),m.cb)
    kernel.CloseHandle(handle)
    return dict(working_set_mb=round(m.WorkingSetSize/2**20,2),private_commit_mb=round(m.PagefileUsage/2**20,2)) if ok else {}

def metadata():
    start = time.monotonic()
    with urlopen('http://127.0.0.1:5173/api/asn/1299',timeout=5) as response:
        data=json.load(response)
    return dict(metadata_ms=round((time.monotonic()-start)*1000,2),metadata_organization=data.get('organization'),metadata_retry=data.get('retry_after'))

async def main():
    start=time.monotonic(); first_total=None; last_total=None; gaps=[]; samples=[]; errors=[]; count=0; upstream_false=0; previous=None; next_sample=0; sessions=0
    OUT.write_text('')
    while time.monotonic()-start<DURATION:
        try:
            async with connect('ws://127.0.0.1:5173/ws',open_timeout=10,max_size=2**22,ping_interval=20,ping_timeout=20) as ws:
                sessions+=1
                while time.monotonic()-start<DURATION:
                    raw=await asyncio.wait_for(ws.recv(),15)
                    now=time.monotonic(); s=json.loads(raw); count+=1
                    if previous is not None:gaps.append(now-previous)
                    previous=now
                    if first_total is None:first_total=s['global_total']
                    last_total=s['global_total']
                    upstream_false+=not s['connected']
                    if now-start>=next_sample:
                        row=dict(elapsed=round(now-start,2),wall_time=time.time(),snapshots=count,total=last_total,connected=s['connected'],nodes=len(s['topology']['nodes']),named_nodes=sum(bool(n.get('organization')) for n in s['topology']['nodes']),ranking_named=sum(bool(n.get('organization')) for n in s['top_asns']),events=len(s['events']),**memory())
                        try:row.update(await asyncio.to_thread(metadata))
                        except Exception as exc:row['metadata_error']=str(exc)
                        samples.append(row)
                        with OUT.open('a') as f:f.write(json.dumps(row)+'\n')
                        print(json.dumps(row),flush=True)
                        next_sample+=30
        except Exception as exc:
            errors.append(dict(elapsed=round(time.monotonic()-start,2),error=str(exc)))
            await asyncio.sleep(2)
    result=dict(duration_seconds=round(time.monotonic()-start,2),pid=PID,snapshots=count,sessions=sessions,reconnects=max(0,sessions-1),upstream_disconnected_snapshots=upstream_false,first_total=first_total,last_total=last_total,new_updates=(last_total-first_total) if last_total is not None else None,gap_median=statistics.median(gaps) if gaps else None,gap_max=max(gaps) if gaps else None,gap_p95=sorted(gaps)[int(len(gaps)*.95)] if gaps else None,errors=errors,samples=samples)
    SUMMARY.write_text(json.dumps(result,indent=2))
    print('COMPLETE '+json.dumps({k:v for k,v in result.items() if k!='samples'}),flush=True)

asyncio.run(main())
