const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const schemaSource=fs.readFileSync(path.join(__dirname,'../previsao-custo-schema.js'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../previsao-custo-store.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const ctx=vm.createContext({});vm.runInContext(schemaSource,ctx);const schema=ctx.DiamondPrevisaoSchema;
const error=(message,status)=>Object.assign(Error(message),{status});
function server(){
  let record=copy(schema.envelope(0,null,schema.defaults())),writes=0;
  const operations=new Map();
  return {get record(){return copy(record);},get writes(){return writes;},set record(value){record=copy(value);},async api(body,user){
    if(body.operacao==='carregar')return {ok:true,registro:copy(record)};
    assert.equal(body.operacao,'salvar');assert.match(body.operacaoId,/^[\da-f-]{36}$/);
    const signature=JSON.stringify([body.revisao,body.dados,user.usuario]),old=operations.get(body.operacaoId);
    if(old){if(old!==signature)throw error('Operação diferente.',409);return {ok:true,registro:copy(record),repetida:true};}
    if(body.revisao!==record.revision)throw error('A previsão mudou. Atualize antes de salvar.',409);
    record=copy(schema.envelope(record.revision+1,new Date().toISOString(),schema.validate(body.dados),user.usuario));
    operations.set(body.operacaoId,signature);writes++;return {ok:true,registro:copy(record)};
  }};
}
function fixture({memory=new Map(),origin='http://127.0.0.1:8791',user='domo',backend=server(),now}={}){
  let allowed=true,session={usuario:user,senhaHash:'hash-1',papel:'admin'},quota=false,offline=false,hook=null,reads=0;
  const events=[],calls=[];
  const localStorage={getItem:key=>{reads++;return memory.has(key)?memory.get(key):null;},setItem:(key,value)=>{if(quota)throw Error('QuotaExceededError');memory.set(key,value);},removeItem:key=>{if(quota)throw Error('QuotaExceededError');memory.delete(key);}};
  const window={crypto,location:{origin},localStorage,STORE:{getUser:()=>session,podeVerPainel:()=>allowed,api:async(action,body)=>{assert.equal(action,'previsaoCusto');calls.push(copy(body));if(offline)throw Error('Sem conexão.');const requestUser=copy(session);return hook?hook(body,()=>backend.api(body,requestUser)):backend.api(body,requestUser);}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};
  const Clock=now?class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}:Date;
  const context=vm.createContext({window,Date:Clock});vm.runInContext(schemaSource,context);vm.runInContext(source,context);
  const suffix=encodeURIComponent(origin)+':'+encodeURIComponent(user);
  return {store:window.DiamondPrevisaoStore,schema:window.DiamondPrevisaoSchema,memory,backend,events,calls,window,legacyKey:'dv_previsao_custo_v1:'+suffix,cloudKey:'dv_previsao_custo_cloud_v1:'+suffix,setAllowed:value=>{allowed=value;},setUser:value=>{session=value;},setQuota:value=>{quota=value;},setOffline:value=>{offline=value;},setHook:value=>{hook=value;},readCount:()=>reads};
}
function sample(f){
  const data=f.schema.defaults();data.contributionsReviewed=true;
  data.contributions=[{id:'a-1',socio:'Sócio de exemplo',data:'2026-02-28',valorCents:12345,observacao:'Aporte informado'}];
  data.contracts={'u-101':{contractKey:'u-101/cliente-1/rev-1',commissionCents:null,finalSeriesIndices:[1],receiptsReviewed:true}};
  data.receipts=[{id:'r-1',unitId:'u-101',contractKey:'u-101/cliente-1/rev-1',data:'2026-02-28',valorCents:23456,natureza:'final',observacao:'Recebimento informado'}];return data;
}
function seedLegacy(f,data=sample(f)){
  const raw=JSON.stringify({...f.schema.envelope(4,'2026-03-01T00:00:00.000Z',data),status:'Salvo neste navegador'});
  f.memory.set(f.legacyKey,raw);return raw;
}
test('schema do navegador e API são cópias idênticas',()=>{assert.equal(schemaSource,fs.readFileSync(path.join(__dirname,'../supabase/functions/dmd-api/previsao-custo-schema.js'),'utf8'));});
test('primeira leitura vem da API e mantém ausência de recebimentos como desconhecida',async()=>{
  const f=fixture(),r=await f.store.load();assert.deepEqual(copy(r),copy(schema.envelope(0,null,schema.defaults())));assert.equal(f.calls.length,1);assert.equal(r.status,'Salvo no sistema');
  r.data.settings.targetCents=1;assert.equal((await f.store.load()).data.settings.targetCents,1700000000);assert.ok(f.memory.has(f.cloudKey+':confirmed'));
});
test('dois aparelhos com armazenamentos distintos consultam a mesma previsão central',async()=>{
  const f=fixture(),second=fixture({backend:f.backend}),data=sample(f),saved=await f.store.save(data,0);
  assert.equal(saved.revision,1);assert.equal(saved.status,'Salvo no sistema');assert.equal(saved.updatedBy,'domo');assert.equal(f.events.length,1);assert.equal(f.events[0].type,'diamond-previsao-change');
  assert.deepEqual(copy(await second.store.load()),copy(saved));assert.deepEqual(JSON.parse(second.store.exportData()).data,copy(data));
  data.receipts[0].valorCents=1;assert.equal((await f.store.load()).data.receipts[0].valorCents,23456);assert.equal(f.memory.has(f.legacyKey),false);
});
test('conflito entre aparelhos preserva registro central e rascunho do segundo aparelho',async()=>{
  const f=fixture(),second=fixture({backend:f.backend}),draft=(await second.store.load()).data;draft.settings.targetCents=555;
  await f.store.save(sample(f),0);await assert.rejects(second.store.save(draft,0),e=>e.status===409);
  assert.equal(draft.settings.targetCents,555);assert.equal(f.backend.record.data.receipts.length,1);assert.equal(second.events.length,0);assert.equal(f.backend.writes,1);
});
test('salvamento offline não usa fila, não confirma gravação e mantém cache confirmado',async()=>{
  const f=fixture();await f.store.save(sample(f),0);const cached=f.memory.get(f.cloudKey+':confirmed'),draft=sample(f);draft.settings.targetCents=11;f.setOffline(true);
  await assert.rejects(f.store.save(draft,1),/Sem conexão/);await assert.rejects(f.store.load(),/Sem conexão/);
  assert.equal(f.memory.get(f.cloudKey+':confirmed'),cached);assert.equal(f.events.length,1);assert.equal(f.backend.writes,1);
  assert.equal([...f.memory.keys()].some(key=>/queue|fila/.test(key)),false);f.setOffline(false);await f.store.load();assert.equal(f.backend.writes,1);
});
test('resposta perdida após commit reutiliza ID durável após reload, sem duplicar revisão',async()=>{
  const f=fixture(),data=sample(f);let once=true;
  f.setHook(async(body,run)=>{const response=await run();if(body.operacao==='salvar'&&once){once=false;throw Error('Resposta perdida');}return response;});
  await assert.rejects(f.store.save(data,0),/Resposta perdida/);assert.equal(f.backend.writes,1);assert.equal(f.events.length,0);
  const operationId=f.calls[0].operacaoId,reloaded=fixture({memory:f.memory,backend:f.backend});
  const saved=await reloaded.store.save(data,0);assert.equal(saved.revision,1);assert.equal(reloaded.calls[0].operacaoId,operationId);assert.equal(f.backend.writes,1);
  assert.equal(reloaded.memory.has(reloaded.cloudKey+':pending'),false);
});
test('retry confirmado devolve estado mais novo e não reverte edição de outro aparelho',async()=>{
  const f=fixture(),data=sample(f);f.setHook(async(body,run)=>{await run();throw Error('Resposta perdida');});await assert.rejects(f.store.save(data,0));
  const second=fixture({backend:f.backend}),latest=copy(f.backend.record.data);latest.settings.targetCents=77;await second.store.save(latest,1);
  f.setHook(null);const retried=await f.store.save(data,0);assert.equal(retried.revision,2);assert.equal(retried.data.settings.targetCents,77);assert.equal(f.backend.writes,2);
});
test('toda operação exige autorização atual, inclusive exportação e inspeção local',async()=>{
  const f=fixture(),data=sample(f),saved=await f.store.save(data,0),json=f.store.exportData(saved),before=[...f.memory];f.setAllowed(false);const reads=f.readCount(),calls=f.calls.length;
  for(const run of [()=>f.store.load(),()=>f.store.save(data,1),()=>f.store.importData(json,1),()=>f.store.migrateLegacy(1)])await assert.rejects(run,/Acesso restrito/);
  for(const run of [()=>f.store.exportData(saved),()=>f.store.inspectLegacy(),()=>f.store.legacyStatus()])assert.throws(run,/Acesso restrito/);
  assert.equal(f.calls.length,calls);assert.equal(f.readCount(),reads);assert.deepEqual([...f.memory],before);f.setAllowed(true);f.setUser(null);await assert.rejects(f.store.load(),/Sessão inválida/);
});
test('troca de usuário ou credencial durante leitura impede exibir e armazenar a resposta',async()=>{
  for(const next of [{usuario:'admin',senhaHash:'hash-1',papel:'admin'},{usuario:'domo',senhaHash:'hash-2',papel:'admin'},null]){
    const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});f.setHook(async(_,run)=>{await gate;return run();});
    const loading=f.store.load();f.setUser(next);release();await assert.rejects(loading,/sessão mudou|Sessão inválida/);assert.equal(f.memory.size,0);assert.equal(f.events.length,0);
  }
});
test('troca de sessão durante gravação não anuncia nem armazena resposta sob o novo usuário',async()=>{
  const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});f.setHook(async(_,run)=>{const response=await run();await gate;return response;});
  const saving=f.store.save(sample(f),0);f.setUser({usuario:'admin',senhaHash:'hash-2',papel:'admin'});release();await assert.rejects(saving,/sessão mudou/);
  assert.equal(f.events.length,0);assert.equal(f.memory.has(f.cloudKey+':confirmed'),false);assert.equal([...f.memory.keys()].some(k=>k.endsWith(':admin:confirmed')),false);
});
test('perda de permissão durante chamada também bloqueia a resposta',async()=>{
  const f=fixture();f.setHook(async(_,run)=>{const r=await run();f.setAllowed(false);return r;});await assert.rejects(f.store.load(),/Acesso restrito/);assert.equal(f.memory.size,0);
});
test('cache confirmado fica separado por usuário/origem sem limitar compartilhamento central',async()=>{
  const f=fixture();await f.store.save(sample(f),0);const other=fixture({memory:f.memory,backend:f.backend,user:'admin',origin:'https://example.invalid'});await other.store.load();
  assert.equal(f.memory.has(f.cloudKey+':confirmed'),true);assert.equal(f.memory.has(other.cloudKey+':confirmed'),true);assert.equal((await other.store.load()).data.receipts.length,1);
});
test('quota ou armazenamento bloqueado não impedem gravação central confirmada',async()=>{
  for(const kind of ['quota','security']){const f=fixture();if(kind==='quota')f.setQuota(true);else Object.defineProperty(f.window,'localStorage',{get(){throw Error('SecurityError');}});
    const loaded=await f.store.load(),saved=await f.store.save(sample(f),loaded.revision);assert.equal(saved.revision,1);assert.equal(f.events.length,1);assert.match(f.store.legacyStatus().localError,/navegador/);
  }
});
test('cache local corrompido e legado inválido não bloqueiam consulta central nem apagam legado',async()=>{
  const f=fixture(),raw='{';f.memory.set(f.legacyKey,raw);f.memory.set(f.cloudKey+':confirmed','{');
  const r=await f.store.load();assert.equal(r.revision,0);assert.equal(f.memory.get(f.legacyKey),raw);assert.match(f.store.legacyStatus().error,/registro local está inválido/);
  const saved=await f.store.save(sample(f),0);assert.equal(saved.revision,1);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('migração automática ocorre somente no central vazio, preserva bytes originais e marca após ACK',async()=>{
  const f=fixture(),raw=seedLegacy(f),r=await f.store.load();assert.equal(r.revision,1);assert.equal(r.data.receipts.length,1);assert.equal(f.memory.get(f.legacyKey),raw);assert.equal(f.store.legacyStatus().migrated,true);
  assert.equal(f.store.legacyStatus().pending,false);assert.equal(f.memory.has(f.cloudKey+':migrated'),true);assert.equal(f.memory.has(f.cloudKey+':migration'),false);assert.equal(f.backend.writes,1);
  await f.store.load();assert.equal(f.backend.writes,1);
});
test('registro local somente com premissas padrão não dispara migração',async()=>{
  const f=fixture(),raw=seedLegacy(f,f.schema.defaults());assert.equal((await f.store.load()).revision,0);assert.equal(f.backend.writes,0);assert.equal(f.memory.get(f.legacyKey),raw);assert.equal(f.store.legacyStatus().pending,false);
});
test('após migração, excluir registros no central não os ressuscita de backup antigo',async()=>{
  const f=fixture(),raw=seedLegacy(f),r=await f.store.load();const data=copy(r.data);data.contributions=[];data.receipts=[];await f.store.save(data,r.revision);
  const reload=fixture({memory:f.memory,backend:f.backend}),latest=await reload.store.load();assert.equal(latest.data.receipts.length,0);assert.equal(latest.data.contributions.length,0);assert.equal(f.backend.writes,2);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('perda de resposta na migração retoma ID durável e recebe estado central mais recente',async()=>{
  const f=fixture(),raw=seedLegacy(f);let once=true;f.setHook(async(body,run)=>{const response=await run();if(body.operacao==='salvar'&&once){once=false;throw Error('Resposta perdida');}return response;});
  const initial=await f.store.load();assert.equal(initial.revision,0);assert.match(f.store.legacyStatus().error,/Resposta perdida/);assert.equal(f.memory.has(f.cloudKey+':migrated'),false);
  const op=f.calls.find(c=>c.operacao==='salvar').operacaoId,other=fixture({backend:f.backend}),latest=copy(f.backend.record.data);latest.receipts=[];await other.store.save(latest,1);
  const reload=fixture({memory:f.memory,backend:f.backend}),r=await reload.store.load();assert.equal(r.revision,2);assert.equal(r.data.receipts.length,0);assert.equal(reload.calls.find(c=>c.operacao==='salvar').operacaoId,op);assert.equal(f.backend.writes,2);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('sem controle durável disponível, migração preserva legado e não envia gravação',async()=>{
  const f=fixture(),raw=seedLegacy(f);f.setQuota(true);const r=await f.store.load();assert.equal(r.revision,0);assert.equal(f.backend.writes,0);assert.match(f.store.legacyStatus().error,/migração aguarda espaço/);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('legado de outro usuário ou origem não é inspecionado nem migrado',async()=>{
  const f=fixture(),raw=seedLegacy(f),other=fixture({memory:f.memory,backend:f.backend,user:'admin'}),origin=fixture({memory:f.memory,backend:f.backend,origin:'https://example.invalid'});
  await other.store.load();await origin.store.load();assert.equal(f.backend.writes,0);assert.equal(other.store.legacyStatus().available,false);assert.equal(origin.store.legacyStatus().available,false);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('central existente requer migração explícita, deduplica IDs iguais e adiciona apenas ausentes',async()=>{
  const f=fixture(),central=sample(f);central.contributions.push({...central.contributions[0],id:'a-central'});await f.store.save(central,0);
  const local=sample(f);local.receipts.push({...local.receipts[0],id:'r-local',valorCents:34567});const raw=seedLegacy(f,local),loaded=await f.store.load();
  assert.equal(loaded.revision,1);assert.equal(f.backend.writes,1);assert.equal(f.store.legacyStatus().pending,true);
  const merged=await f.store.migrateLegacy(1);assert.equal(merged.revision,2);assert.deepEqual(copy(merged.data.contributions.map(x=>x.id)),['a-1','a-central']);assert.deepEqual(copy(merged.data.receipts.map(x=>x.id)),['r-1','r-local']);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('migração conflitante bloqueia settings, IDs e contratos sem modificar central ou legado',async()=>{
  for(const mutate of [d=>d.settings.targetCents=1,d=>d.contributions[0].valorCents=9,d=>d.receipts[0].valorCents=9,d=>d.contracts['u-101'].commissionCents=9]){
    const f=fixture();await f.store.save(sample(f),0);const local=sample(f);mutate(local);const raw=seedLegacy(f,local),before=f.backend.record;await f.store.load();
    await assert.rejects(f.store.migrateLegacy(1),e=>e.status===409&&e.conflicts.length>0);assert.deepEqual(f.backend.record,before);assert.equal(f.memory.get(f.legacyKey),raw);assert.equal(f.memory.has(f.cloudKey+':migrated'),false);
  }
});
test('migração explícita com revisão obsoleta não substitui alterações recentes',async()=>{
  const f=fixture();await f.store.save(sample(f),0);seedLegacy(f);await assert.rejects(f.store.migrateLegacy(0),e=>e.status===409);assert.equal(f.backend.writes,1);
});
test('importação valida antes de substituir e salva nova revisão central',async()=>{
  const f=fixture(),saved=await f.store.save(sample(f),0),json=f.store.exportData(saved);const to=fixture();await to.store.save(to.schema.defaults(),0);const imported=await to.store.importData(json,1);assert.equal(imported.revision,2);assert.equal(imported.data.receipts[0].valorCents,23456);
  await assert.rejects(to.store.importData(json,1),e=>e.status===409);const writes=to.backend.writes;
  for(const bad of ['{',JSON.stringify({schema:2,data:{}}),JSON.stringify({...JSON.parse(json),revision:-1}),JSON.stringify({...JSON.parse(json),updatedAt:'2026-02-30'})])await assert.rejects(to.store.importData(bad,2));assert.equal(to.backend.writes,writes);
});
test('revisões inválidas são rejeitadas antes da API',async()=>{
  const f=fixture();for(const bad of [undefined,null,-1,1.1,'2',Infinity])await assert.rejects(f.store.save(sample(f),bad),/Revisão esperada/);assert.equal(f.calls.length,0);
});
test('valores, datas, IDs, campos desconhecidos e listas esparsas inválidos não chegam à API',async()=>{
  const f=fixture(),valid=sample(f),mutations=[d=>d.settings.targetCents=-1,d=>d.settings.targetCents=0,d=>d.settings.targetCents=1.5,d=>d.settings.targetCents=Number.MAX_SAFE_INTEGER+1,d=>d.settings.futurePaymentShare=1.1,d=>d.settings.futureCommissionRate=NaN,d=>d.settings.futureCommissionRate=5,d=>d.contributions[0].data='2026-02-30',d=>d.contributions[0].data='2026-13-01',d=>d.contributions[0].valorCents='1',d=>d.contributions.push(copy(d.contributions[0])),d=>d.receipts.push(copy(d.receipts[0])),d=>d.contracts['u-101'].commissionCents=-1,d=>d.contracts['u-101'].finalSeriesIndices=[1,1],d=>d.contracts['u-101'].finalSeriesIndices=[.5],d=>d.contracts['u-101'].finalSeriesIndices=null,d=>delete d.contracts['u-101'].finalSeriesIndices,d=>d.contracts['u-101'].receiptsReviewed='true',d=>d.receipts[0].natureza='permuta',d=>d.contributionsReviewed='true',d=>d.contributions[0].id='__proto__',d=>d.unknown=1,d=>d.contributions=Array(1),d=>d.receipts=Array(1),d=>d.contracts['u-101'].finalSeriesIndices=Array(1)];
  for(const mutate of mutations){const data=copy(valid);mutate(data);await assert.rejects(f.store.save(data,0));}assert.equal(f.calls.length,0);
});
test('contrato sem conferência, zero explícito, ano bissexto, comissão nula e percentuais extremos são válidos',async()=>{
  const f=fixture(),data=sample(f);delete data.contracts['u-101'].receiptsReviewed;data.settings={targetCents:1,futurePaymentShare:0,futureCommissionRate:1};data.contributions[0].valorCents=0;data.contributions[0].data='2024-02-29';data.contracts['u-101'].commissionCents=0;
  const saved=await f.store.save(data,0);assert.equal(saved.data.contracts['u-101'].receiptsReviewed,false);assert.equal(saved.data.contracts['u-101'].commissionCents,0);data.contracts['u-101'].commissionCents=null;assert.equal((await f.store.save(data,1)).data.contracts['u-101'].commissionCents,null);
});
test('datas futuras em Brasília e importação acima de 1 MiB são rejeitadas antes da API',async()=>{
  const f=fixture({now:'2026-11-02T02:30:00.000Z'}),valid=sample(f);for(const collection of ['contributions','receipts']){const data=copy(valid);data[collection][0].data='2026-11-02';await assert.rejects(f.store.save(data,0),/até hoje/);await assert.rejects(f.store.importData(JSON.stringify(schema.envelope(1,'2026-03-01T00:00:00.000Z',data)),0),/até hoje/);}
  await assert.rejects(f.store.importData(' '.repeat(1024*1024+1),0),/1 MB/);const large=copy(valid);large.contributions=Array.from({length:600},(_,i)=>({...large.contributions[0],id:'a-'+i,observacao:'á'.repeat(1900)}));await assert.rejects(f.store.save(large,0),/1 MB/);assert.equal(f.calls.length,0);
  valid.contributions[0].data='2026-11-01';valid.receipts[0].data='2026-11-01';assert.equal((await f.store.save(valid,0)).revision,1);
});
test('referência completa de contrato longo permanece íntegra na exportação e importação',async()=>{
  const f=fixture(),data=sample(f),key=JSON.stringify(['u-101','c-1',1,Array.from({length:20},(_,i)=>({descricao:'Série '+i+' '+('x'.repeat(100)),valor:10000,quantidade:20,intervalo:1,primeiro:'2026-11-01'}))]);
  assert.ok(key.length>2048);data.contracts['u-101'].contractKey=key;data.receipts[0].contractKey=key;const saved=await f.store.save(data,0),target=fixture();await target.store.importData(f.store.exportData(saved),0);assert.equal((await target.store.load()).data.receipts[0].contractKey,key);
});
test('edição posterior de aba antiga invalida o marcador e aguarda merge explícito',async()=>{
  const f=fixture();seedLegacy(f);const first=await f.store.load(),oldMarker=f.memory.get(f.cloudKey+':migrated');
  const local=sample(f);local.receipts.push({...local.receipts[0],id:'r-late',valorCents:34567});const raw=seedLegacy(f,local),loaded=await f.store.load();
  assert.equal(loaded.revision,first.revision);assert.equal(loaded.data.receipts.length,1);assert.equal(f.backend.writes,1);assert.equal(f.store.legacyStatus().pending,true);assert.equal(f.store.legacyStatus().changedSinceMigration,true);
  assert.equal(f.memory.get(f.cloudKey+':migrated'),oldMarker);const merged=await f.store.migrateLegacy(loaded.revision);assert.equal(merged.data.receipts.length,2);assert.equal(f.store.legacyStatus().migrated,true);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('marcador também detecta revisão e atualização novas mesmo sem mudança de dados',async()=>{
  const f=fixture();seedLegacy(f);await f.store.load();const later=JSON.parse(f.memory.get(f.legacyKey));later.revision++;later.updatedAt='2026-03-02T00:00:00.000Z';f.memory.set(f.legacyKey,JSON.stringify(later));await f.store.load();
  assert.equal(f.store.legacyStatus().changedSinceMigration,true);assert.equal(f.store.legacyStatus().pending,true);assert.equal(f.backend.writes,1);
});
test('409 da migração remove só tentativa rejeitada e permite novo merge com revisão atual',async()=>{
  const f=fixture(),raw=seedLegacy(f);let race=true;
  f.setHook(async(body,run)=>{if(body.operacao==='salvar'&&race){race=false;const other=fixture({backend:f.backend}),data=sample(other);data.contributions.push({...data.contributions[0],id:'a-other'});await other.store.save(data,0);}return run();});
  const loaded=await f.store.load(),failedId=f.calls.find(c=>c.operacao==='salvar').operacaoId;assert.equal(loaded.revision,1);assert.equal(loaded.data.contributions.length,2);assert.equal(f.memory.has(f.cloudKey+':migration'),false);assert.equal(f.memory.get(f.legacyKey),raw);
  assert.match(f.store.legacyStatus().error,/mudou/);const merged=await f.store.migrateLegacy(loaded.revision),ids=f.calls.filter(c=>c.operacao==='salvar').map(c=>c.operacaoId);assert.equal(merged.revision,2);assert.notEqual(ids.at(-1),failedId);assert.equal(merged.data.contributions.length,2);assert.equal(merged.data.receipts.length,1);assert.equal(f.store.legacyStatus().migrated,true);
});
test('legado alterado após resposta perdida reconcilia tentativa antiga e mantém alteração nova pendente',async()=>{
  const f=fixture();seedLegacy(f);f.setHook(async(body,run)=>{const response=await run();if(body.operacao==='salvar')throw Error('Resposta perdida');return response;});await f.store.load();
  const local=sample(f);local.receipts.push({...local.receipts[0],id:'r-late',valorCents:34567});seedLegacy(f,local);f.setHook(null);const loaded=await f.store.load();assert.equal(loaded.revision,1);assert.equal(f.backend.writes,1);assert.equal(f.store.legacyStatus().pending,true);
  const merged=await f.store.migrateLegacy(loaded.revision);assert.equal(merged.revision,2);assert.equal(merged.data.receipts.length,2);assert.equal(f.store.legacyStatus().migrated,true);
});
test('falha ao persistir marcador após ACK retoma a mesma migração sem nova revisão',async()=>{
  const f=fixture(),raw=seedLegacy(f);f.setHook(async(body,run)=>{const response=await run();if(body.operacao==='salvar')f.setQuota(true);return response;});
  const saved=await f.store.load(),operationId=f.calls.find(c=>c.operacao==='salvar').operacaoId;assert.equal(saved.revision,1);assert.equal(f.memory.has(f.cloudKey+':migrated'),false);assert.equal(f.memory.has(f.cloudKey+':migration'),true);assert.match(f.store.legacyStatus().error,/confirmada no sistema/);
  const reload=fixture({memory:f.memory,backend:f.backend}),r=await reload.store.load();assert.equal(r.revision,1);assert.equal(f.backend.writes,1);assert.equal(reload.calls.find(c=>c.operacao==='salvar').operacaoId,operationId);assert.equal(reload.store.legacyStatus().migrated,true);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('troca de sessão durante migração impede gravar marcador ou emitir confirmação',async()=>{
  const f=fixture(),raw=seedLegacy(f);f.setHook(async(body,run)=>{const response=await run();if(body.operacao==='salvar')f.setUser({usuario:'admin',senhaHash:'other',papel:'admin'});return response;});
  await assert.rejects(f.store.load(),/sessão mudou/);assert.equal(f.events.length,0);assert.equal(f.memory.has(f.cloudKey+':migrated'),false);assert.equal(f.memory.get(f.legacyKey),raw);
});
test('merge bloqueia provável aporte duplicado com ID distinto, sócio normalizado e observação diferente',async()=>{
  const f=fixture(),central=sample(f);await f.store.save(central,0);const local=sample(f);local.contributions[0]={...local.contributions[0],id:'aporte-outro-aparelho',socio:'  SOCIO   de exemplo  ',observacao:'Outra descrição do mesmo aporte'};const raw=seedLegacy(f,local),before=f.backend.record;await f.store.load();
  await assert.rejects(f.store.migrateLegacy(1),e=>e.status===409&&/Possível aporte duplicado/.test(e.message)&&/Confira os dois lançamentos/.test(e.message));assert.deepEqual(f.backend.record,before);assert.equal(f.memory.get(f.legacyKey),raw);assert.equal(f.backend.writes,1);
});
test('merge bloqueia provável recebimento duplicado com ID distinto ignorando observação e referência contratual',async()=>{
  const f=fixture();await f.store.save(sample(f),0);const local=sample(f);local.receipts[0]={...local.receipts[0],id:'recebimento-outro-aparelho',observacao:'Anotado no celular',contractKey:'referencia-antiga'};const raw=seedLegacy(f,local),before=f.backend.record;await f.store.load();
  await assert.rejects(f.store.migrateLegacy(1),e=>e.status===409&&/Possível recebimento duplicado/.test(e.message));assert.deepEqual(f.backend.record,before);assert.equal(f.memory.get(f.legacyKey),raw);assert.equal(f.backend.writes,1);
});
test('novos aportes e recebimentos exigem nova conferência após união, preservando contratos sem novos recebimentos',async()=>{
  const f=fixture(),central=sample(f);central.contracts['u-202']={...central.contracts['u-101'],contractKey:'u-202/rev-1'};await f.store.save(central,0);const local=copy(central);local.contributions.push({...local.contributions[0],id:'a-new',valorCents:999});local.receipts.push({...local.receipts[0],id:'r-new',valorCents:999});seedLegacy(f,local);await f.store.load();
  const merged=await f.store.migrateLegacy(1);assert.equal(merged.data.contributions.length,2);assert.equal(merged.data.receipts.length,2);assert.equal(merged.data.contributionsReviewed,false);assert.equal(merged.data.contracts['u-101'].receiptsReviewed,false);assert.equal(merged.data.contracts['u-202'].receiptsReviewed,true);
});
test('merge somente de IDs já conhecidos preserva conferências existentes',async()=>{
  const f=fixture(),central=sample(f);await f.store.save(central,0);seedLegacy(f,central);await f.store.load();const merged=await f.store.migrateLegacy(1);assert.equal(merged.data.contributionsReviewed,true);assert.equal(merged.data.contracts['u-101'].receiptsReviewed,true);assert.equal(merged.data.contributions.length,1);assert.equal(merged.data.receipts.length,1);
});
