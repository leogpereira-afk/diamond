// Authenticated transport; credentials stay in the POST body, never in the URL.
// Subscription payload is an allowlist, even if the database schema changes.
export function disponibilidadeStream(sb, signal) {
 let channel, heartbeat, expiry, closed=false, controller;
 const encoder=new TextEncoder();
 const send=value=>{if(!closed)controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));};
 const close=()=>{
  if(closed)return;closed=true;
  clearInterval(heartbeat);clearTimeout(expiry);
  signal?.removeEventListener('abort',close);
  if(channel)void sb.removeChannel(channel);
  try{controller?.close();}catch{}
 };
 const stream=new ReadableStream({
  start(c){
   controller=c;
   channel=sb.channel('availability-'+crypto.randomUUID()).on('postgres_changes',
    {event:'*',schema:'public',table:'dmd_disponibilidade'},
    payload=>{const row=payload.new;if(typeof row?.id==='string'&&typeof row.status==='string')send({type:'unit',id:row.id,status:row.status});});
   channel.subscribe(state=>{
    if(state==='SUBSCRIBED')send({type:'ready'});
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(state))close();
   });
   heartbeat=setInterval(()=>send({type:'heartbeat'}),15000);
   // Renew authentication and connection before the Edge worker lifetime limit.
   expiry=setTimeout(close,110000);
   signal?.addEventListener('abort',close,{once:true});
   if(signal?.aborted)close();
  },
  cancel(){close();}
 });
 return stream;
}
