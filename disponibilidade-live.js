/* Push connection with bounded retry and session-scoped delivery. */
window.criarDisponibilidadeLive = function({url, token, sessao, receber, sincronizar}) {
 let controller=null, timer=null, identity='', stopped=false, attempt=0;
 const key=s=>s ? JSON.stringify([s.usuario,s.senhaHash,s.papel]) : '';
 function restart(force=false){
  const next=key(sessao());
  if(!force && next===identity && controller)return;
  identity=next;controller?.abort();controller=null;clearTimeout(timer);
  if(!stopped && next)connect(next);
 }
 async function connect(scope){
  const abort=new AbortController();controller=abort;
  let watchdog;
  const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>abort.abort(),25000);};
  try{
   alive();const s=sessao();
   const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-token':token},body:JSON.stringify({action:'disponibilidadeAoVivo',auth:{usuario:s.usuario,senhaHash:s.senhaHash}}),signal:abort.signal});
   if(!res.ok||!res.body)throw Error('Live unavailable');
   const reader=res.body.getReader(), decoder=new TextDecoder();let pending='';
   while(!abort.signal.aborted){
    const {done,value}=await reader.read();if(done)break;
    if(key(sessao())!==scope)break;
    alive();pending+=decoder.decode(value,{stream:true});
    let end;while((end=pending.indexOf('\n'))!==-1){
     const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;
     const event=JSON.parse(line);
     if(event.type==='ready'){attempt=0;sincronizar();}
     else if(event.type==='unit')receber(event);
    }
    if(pending.length>16384)throw Error('Invalid live message');
   }
  }catch{}finally{
   clearTimeout(watchdog);abort.abort();
   if(controller===abort){controller=null;
    if(!stopped&&scope===key(sessao()))timer=setTimeout(()=>connect(scope),Math.min(500*2**attempt++,10000));
   }
  }
 }
 return {restart,stop(){stopped=true;clearTimeout(timer);controller?.abort();controller=null;}};
};
