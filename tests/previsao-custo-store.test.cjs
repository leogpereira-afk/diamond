const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../previsao-custo-store.js'),'utf8');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture({memory=new Map(),origin='http://127.0.0.1:8791',user='domo',now}={}){
  let allowed=true,session={usuario:user},quota=false,reads=0;
  const events=[];
  const localStorage={getItem:key=>{reads++;return memory.has(key)?memory.get(key):null;},setItem:(key,value)=>{if(quota)throw Error('QuotaExceededError');memory.set(key,value);}};
  const window={location:{origin},localStorage,STORE:{getUser:()=>session,podeVerPainel:()=>allowed},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};
  const Clock=now?class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}:Date;
  const context=vm.createContext({window,Date:Clock});vm.runInContext(source,context);
  return {store:window.DiamondPrevisaoStore,memory,events,window,setAllowed:value=>{allowed=value;},setUser:value=>{session=value;},setQuota:value=>{quota=value;},readCount:()=>reads};
}
const sample=store=>{
  const data=store.load().data;
  data.contributionsReviewed=true;
  data.contributions=[{id:'a-1',socio:'Sócio de exemplo',data:'2026-02-28',valorCents:12345,observacao:'Aporte informado'}];
  data.contracts={'u-101':{contractKey:'u-101/cliente-1/rev-1',commissionCents:null,finalSeriesIndices:[1],receiptsReviewed:true}};
  data.receipts=[{id:'r-1',unitId:'u-101',contractKey:'u-101/cliente-1/rev-1',data:'2026-02-28',valorCents:23456,natureza:'final',observacao:'Recebimento informado'}];
  return data;
};
test('primeira leitura tem premissas locais e mantém ausência de recebimentos como desconhecida',()=>{
  const f=fixture(),r=f.store.load();
  assert.deepEqual(copy(r),{schema:1,revision:0,updatedAt:null,status:'Salvo neste navegador',data:{settings:{targetCents:1700000000,futurePaymentShare:.5,futureCommissionRate:null},contributionsReviewed:false,contributions:[],contracts:{},receipts:[]}});
  assert.equal(f.memory.size,0);r.data.settings.targetCents=1;assert.equal(f.store.load().data.settings.targetCents,1700000000);
});
test('salvar, recarregar e exportar preservam dados sem API, cfg ou fila',()=>{
  const f=fixture(),data=sample(f.store),saved=f.store.save(data,0);
  assert.equal(saved.revision,1);assert.equal(saved.status,'Salvo neste navegador');assert.ok(saved.updatedAt);
  assert.equal(f.events.length,1);assert.equal(f.events[0].type,'diamond-previsao-change');assert.equal(f.events[0].detail.revision,1);
  const reloaded=fixture({memory:f.memory});assert.deepEqual(copy(reloaded.store.load()),copy(saved));
  assert.deepEqual(JSON.parse(reloaded.store.exportData()).data,copy(data));
  assert.deepEqual([...f.memory.keys()].filter(k=>!k.startsWith('dv_previsao_custo_v1:')),[]);
  data.receipts[0].valorCents=1;assert.equal(reloaded.store.load().data.receipts[0].valorCents,23456);
});
test('contratos legados sem conferência não viram recebimentos conhecidos',()=>{
  const f=fixture(),data=sample(f.store);delete data.contracts['u-101'].receiptsReviewed;
  assert.equal(f.store.save(data,0).data.contracts['u-101'].receiptsReviewed,false);
});
test('classificação final ausente ou nula é rejeitada em save e import, preservando o anterior',()=>{
  const f=fixture(),valid=sample(f.store);f.store.save(valid,0);const exported=JSON.parse(f.store.exportData()),before=[...f.memory];
  for(const value of [undefined,null]){
    const data=copy(valid);if(value===undefined)delete data.contracts['u-101'].finalSeriesIndices;else data.contracts['u-101'].finalSeriesIndices=value;
    assert.throws(()=>f.store.save(data,1),/Séries finais/);
    assert.throws(()=>f.store.importData(JSON.stringify({...exported,data}),1),/Séries finais/);
    assert.deepEqual([...f.memory],before);assert.equal(f.events.length,1);
  }
  const explicit=copy(valid);explicit.contracts['u-101'].finalSeriesIndices=[];
  assert.deepEqual(copy(f.store.save(explicit,1).data.contracts['u-101'].finalSeriesIndices),[]);
});
test('listas esparsas não podem gerar um registro que o próprio leitor rejeitaria',()=>{
  const f=fixture(),valid=sample(f.store);f.store.save(valid,0);const before=[...f.memory];
  for(const mutate of [d=>d.contributions=Array(1),d=>d.receipts=Array(1),d=>d.contracts['u-101'].finalSeriesIndices=Array(1)]){
    const data=copy(valid);mutate(data);assert.throws(()=>f.store.save(data,1),/posição vazia/);assert.deepEqual([...f.memory],before);
  }
  assert.equal(f.store.load().revision,1);assert.equal(f.events.length,1);
});
test('toda operação exige autorização atual, inclusive leitura e exportação',()=>{
  const f=fixture(),data=sample(f.store);f.store.save(data,0);const json=f.store.exportData(),before=[...f.memory];f.setAllowed(false);const reads=f.readCount();
  for(const run of [()=>f.store.load(),()=>f.store.save(data,1),()=>f.store.exportData(),()=>f.store.importData(json,1)])assert.throws(run,/Acesso restrito/);
  assert.equal(f.readCount(),reads);assert.deepEqual([...f.memory],before);assert.equal(f.events.length,1);
  f.setAllowed(true);f.setUser(null);assert.throws(()=>f.store.load(),/Sessão inválida/);
});
test('dados são separados por usuário e origem sem apagar o cadastro anterior',()=>{
  const f=fixture(),data=sample(f.store);f.store.save(data,0);
  f.setUser({usuario:'admin'});assert.equal(f.store.load().revision,0);f.store.save(f.store.load().data,0);
  assert.equal(f.memory.size,2);f.setUser({usuario:'domo'});assert.equal(f.store.load().data.receipts.length,1);
  assert.equal(fixture({memory:f.memory,origin:'https://example.invalid'}).store.load().revision,0);
});
test('revisão obsoleta e duas instâncias não sobrescrevem silenciosamente',()=>{
  const f=fixture(),second=fixture({memory:f.memory}),data=sample(f.store),loaded=second.store.load();f.store.save(data,0);
  assert.throws(()=>second.store.save(loaded.data,loaded.revision),/mudou/);assert.equal(f.store.load().data.receipts.length,1);
  assert.equal(second.store.save(second.store.load().data,1).revision,2);
  for(const bad of [undefined,null,-1,1.1,'2',Infinity])assert.throws(()=>f.store.save(data,bad),/Revisão esperada/);
});
test('quota preserva bytes anteriores e não anuncia gravação',()=>{
  const f=fixture(),data=sample(f.store);f.store.save(data,0);const before=[...f.memory];f.setQuota(true);data.settings.targetCents=99;
  assert.throws(()=>f.store.save(data,1),/registro anterior foi preservado/);assert.deepEqual([...f.memory],before);assert.equal(f.events.length,1);
  assert.equal(f.store.load().data.settings.targetCents,1700000000);
});
test('navegador com acesso ao armazenamento bloqueado informa erro em português',()=>{
  const f=fixture();Object.defineProperty(f.window,'localStorage',{get(){throw Error('SecurityError');}});
  assert.throws(()=>f.store.load(),/armazenamento deste navegador está bloqueado/);
  assert.throws(()=>f.store.exportData(),/armazenamento deste navegador está bloqueado/);
});
test('importação valida antes de substituir e sempre usa nova revisão local',()=>{
  const from=fixture();from.store.save(sample(from.store),0);const json=from.store.exportData(),to=fixture();
  to.store.save(to.store.load().data,0);const imported=to.store.importData(json,1);assert.equal(imported.revision,2);assert.equal(imported.data.receipts[0].valorCents,23456);
  const before=[...to.memory];assert.throws(()=>to.store.importData(json,1),/mudou/);assert.deepEqual([...to.memory],before);
  for(const bad of ['{',JSON.stringify({schema:2,data:{}}),JSON.stringify({...JSON.parse(json),revision:-1}),JSON.stringify({...JSON.parse(json),updatedAt:'2026-02-30'})])assert.throws(()=>to.store.importData(bad,2));
  assert.deepEqual([...to.memory],before);
});
test('cache corrompido não é ocultado nem substituído por defaults ou importação',()=>{
  const f=fixture(),data=sample(f.store);f.store.save(data,0);const json=f.store.exportData(),key=[...f.memory.keys()][0];
  for(const raw of ['{',JSON.stringify({...JSON.parse(json),schema:99}),JSON.stringify({...JSON.parse(json),data:{}})]){
    f.memory.set(key,raw);for(const run of [()=>f.store.load(),()=>f.store.save(data,1),()=>f.store.exportData(),()=>f.store.importData(json,1)])assert.throws(run,/registro local está inválido/);
    assert.equal(f.memory.get(key),raw);
  }
});
test('valores inválidos, datas inexistentes, IDs duplicados e campos desconhecidos preservam dados',()=>{
  const f=fixture(),valid=sample(f.store);f.store.save(valid,0);const before=[...f.memory];
  const mutations=[d=>d.settings.targetCents=-1,d=>d.settings.targetCents=1.5,d=>d.settings.targetCents=Number.MAX_SAFE_INTEGER+1,d=>d.settings.futurePaymentShare=1.1,d=>d.settings.futureCommissionRate=NaN,d=>d.settings.futureCommissionRate=5,d=>d.contributions[0].data='2026-02-30',d=>d.contributions[0].data='2026-13-01',d=>d.contributions[0].valorCents='1',d=>d.contributions.push(copy(d.contributions[0])),d=>d.receipts.push(copy(d.receipts[0])),d=>d.contracts['u-101'].commissionCents=-1,d=>d.contracts['u-101'].finalSeriesIndices=[1,1],d=>d.contracts['u-101'].finalSeriesIndices=[.5],d=>d.contracts['u-101'].receiptsReviewed='true',d=>d.receipts[0].natureza='permuta',d=>d.contributionsReviewed='true',d=>d.contributions[0].id='__proto__',d=>d.unknown=1];
  for(const mutate of mutations){const data=copy(valid);mutate(data);assert.throws(()=>f.store.save(data,1));assert.deepEqual([...f.memory],before);}
});
test('zero explícito em lançamentos, ano bissexto, comissão nula e limite de percentuais são aceitos',()=>{
  const f=fixture(),data=sample(f.store);data.settings={targetCents:1,futurePaymentShare:0,futureCommissionRate:1};data.contributions[0].valorCents=0;data.contributions[0].data='2024-02-29';data.contracts['u-101'].commissionCents=0;
  assert.equal(f.store.save(data,0).data.contracts['u-101'].commissionCents,0);
  data.contracts['u-101'].commissionCents=null;assert.equal(f.store.save(data,1).data.contracts['u-101'].commissionCents,null);
});
test('custo previsto zero é rejeitado ao salvar e importar, sem substituir o anterior',()=>{
  const f=fixture(),valid=sample(f.store);f.store.save(valid,0);const before=[...f.memory],exported=JSON.parse(f.store.exportData());
  exported.data.settings.targetCents=0;
  assert.throws(()=>f.store.save(exported.data,1),/Custo previsto.*maior que zero/);
  assert.throws(()=>f.store.importData(JSON.stringify(exported),1),/Custo previsto.*maior que zero/);
  assert.deepEqual([...f.memory],before);
});
test('aportes e recebimentos futuros são rejeitados em save/import pelo dia de Brasília',()=>{
  const f=fixture({now:'2026-11-02T02:30:00.000Z'}),valid=sample(f.store);f.store.save(valid,0);const before=[...f.memory],exported=JSON.parse(f.store.exportData());
  for(const collection of ['contributions','receipts']){
    const value=copy(exported);value.data[collection][0].data='2026-11-02';
    assert.throws(()=>f.store.save(value.data,1),/até hoje/);
    assert.throws(()=>f.store.importData(JSON.stringify(value),1),/até hoje/);
    assert.deepEqual([...f.memory],before);
  }
  const today=copy(valid);today.contributions[0].data='2026-11-01';today.receipts[0].data='2026-11-01';
  assert.equal(f.store.save(today,1).revision,2);
});
test('referência completa de contrato longo permanece íntegra sob o limite global',()=>{
  const f=fixture(),data=sample(f.store);
  const key=JSON.stringify(['u-101','c-1',1,Array.from({length:20},(_,i)=>({descricao:'Série '+i+' '+('x'.repeat(100)),valor:10000,quantidade:20,intervalo:1,primeiro:'2026-11-01'}))]);
  assert.ok(key.length>2048);data.contracts['u-101'].contractKey=key;data.receipts[0].contractKey=key;
  f.store.save(data,0);assert.equal(f.store.load().data.contracts['u-101'].contractKey,key);
  const target=fixture();target.store.importData(f.store.exportData(),0);assert.equal(target.store.load().data.receipts[0].contractKey,key);
});
test('importações e registros acima do limite de JSON não alteram cache',()=>{
  const f=fixture(),data=sample(f.store);f.store.save(data,0);const before=[...f.memory];
  assert.throws(()=>f.store.importData(' '.repeat(1024*1024+1),1),/1 MB/);
  const large=copy(data);large.contributions=Array.from({length:600},(_,i)=>({...large.contributions[0],id:'a-'+i,observacao:'á'.repeat(1900)}));
  assert.throws(()=>f.store.save(large,1),/1 MB/);assert.deepEqual([...f.memory],before);
});
