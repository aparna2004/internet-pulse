export type ConnectionState='connected'|'reconnecting'|'disconnected'|'stale';

// Snapshot arrival is independent of BGP traffic volume and backend last_received.
export function snapshotState(upstreamConnected:boolean,ageMs:number):ConnectionState{
 return ageMs>8000?'stale':upstreamConnected?'connected':'disconnected';
}
