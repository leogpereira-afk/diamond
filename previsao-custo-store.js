/* Registro compartilhado da previsão: apenas a confirmação da API conclui a gravação. */
(function(root){
  'use strict';
  const S=root.DiamondPrevisaoSchema;
  if(!S)throw new Error('Validação da previsão não carregada.');
  const LEGACY='dv_previsao_custo_v1:',PREFIX='dv_previsao_custo_cloud_v1:';
  const states=new Map(),confirmed=new Map(),pending=new Map();
  const copy=value=>JSON.parse(JSON.stringify(value));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const fail=(message,status)=>{const error=new Error(message);if(status)error.status=status;throw error;};
  const revision=value=>{if(!Number.isSafeInteger(value)||value<0)fail('Revisão esperada deve ser um inteiro não negativo.');return value;};
  function access(){
    const store=root.STORE;
    if(!store||typeof store.podeVerPainel!=='function'||!store.podeVerPainel())fail('Acesso restrito à gestão Diamond.',403);
    const user=store.getUser?.();
    if(!user||typeof user.usuario!=='string'||!user.usuario.trim())fail('Sessão inválida. Entre novamente.',401);
    const origin=String(root.location?.origin||'origem-local');
    const scope=encodeURIComponent(origin)+':'+encodeURIComponent(user.usuario);
    return {store,scope,session:JSON.stringify([user.usuario,user.senhaHash,user.papel]),legacyKey:LEGACY+scope,key:PREFIX+scope};
  }
  function guard(ctx){
    const current=access();
    if(current.store!==ctx.store||current.scope!==ctx.scope||current.session!==ctx.session)fail('A sessão mudou. Entre novamente antes de continuar.',401);
  }
  function state(ctx){
    if(!states.has(ctx.scope))states.set(ctx.scope,{available:false,pending:false,migrated:false,error:null,localError:null,conflicts:[],changedSinceMigration:false});
    return states.get(ctx.scope);
  }
  function localRead(ctx,key){
    guard(ctx);
    try{return {raw:root.localStorage.getItem(key),failed:false};}
    catch{state(ctx).localError='Não foi possível ler o armazenamento deste navegador. A cópia local foi preservada.';return {raw:null,failed:true};}
  }
  function localWrite(ctx,key,value){
    guard(ctx);
    try{root.localStorage.setItem(key,value);return true;}
    catch{state(ctx).localError='Não foi possível atualizar a cópia de segurança deste navegador. Os dados confirmados permanecem no sistema.';return false;}
  }
  function localRemove(ctx,key){
    guard(ctx);
    try{root.localStorage.removeItem(key);}catch{/* A operação confirmada pode ser consultada novamente com o mesmo identificador. */}
  }
  function parseLocal(raw,label){
    try{return JSON.parse(raw);}catch{fail(label+' inválido. O conteúdo local foi preservado.');}
  }
  function inspect(ctx){
    guard(ctx);
    const st=state(ctx);Object.assign(st,{available:false,pending:false,migrated:false,error:null,conflicts:[],changedSinceMigration:false});
    const legacy=localRead(ctx,ctx.legacyKey);
    if(legacy.failed){st.error='A cópia local não pôde ser conferida neste navegador.';return {...copy(st),record:null};}
    if(legacy.raw===null)return {...copy(st),record:null};
    let record;
    try{record=S.decode(legacy.raw);}catch(error){st.error='O registro local está inválido e foi preservado. '+error.message;return {...copy(st),record:null};}
    st.available=!same(record.data,S.defaults());
    const marker=localRead(ctx,ctx.key+':migrated');
    if(marker.failed){st.error='Não foi possível conferir a migração anterior. A cópia local foi preservada.';return {...copy(st),record};}
    if(marker.raw!==null){
      try{const value=parseLocal(marker.raw,'Controle de migração');if(value.schema!==1||value.migrated!==true||!value.legacy)fail('Controle de migração inválido. O conteúdo local foi preservado.');const previous=S.decode(JSON.stringify(value.legacy));st.migrated=previous.revision===record.revision&&previous.updatedAt===record.updatedAt&&same(previous.data,record.data);st.changedSinceMigration=!st.migrated;}
      catch(error){st.error=error.message;return {...copy(st),record};}
    }
    st.pending=st.available&&!st.migrated;
    return {...copy(st),record};
  }
  async function request(ctx,body){
    guard(ctx);
    if(typeof ctx.store.api!=='function')fail('Conexão com o sistema indisponível. Atualize a página.');
    let result;
    try{result=await ctx.store.api('previsaoCusto',body);}catch(error){guard(ctx);throw error;}
    guard(ctx);
    if(!result||result.ok!==true||!result.registro)fail('O sistema não confirmou os dados da previsão. Tente novamente.');
    return S.decode(JSON.stringify(result.registro));
  }
  function cache(ctx,record){
    guard(ctx);
    const previous=confirmed.get(ctx.scope);
    if(!previous||record.revision>=previous.revision){confirmed.set(ctx.scope,copy(record));localWrite(ctx,ctx.key+':confirmed',S.size(JSON.stringify(record)));}
    return record;
  }
  function operationId(){
    if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();
    if(typeof root.crypto?.getRandomValues==='function'){
      const bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    }
    fail('Não foi possível gerar um identificador seguro. Abra o sistema em HTTPS e tente novamente.');
  }
  function pendingOperation(ctx,key){
    guard(ctx);
    if(pending.has(key))return pending.get(key);
    const local=localRead(ctx,key);
    if(local.failed||local.raw===null)return null;
    const operation=parseLocal(local.raw,'Controle da gravação pendente');
    if(operation.schema!==1||typeof operation.operacaoId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.operacaoId))fail('Controle da gravação pendente inválido. O conteúdo local foi preservado.');
    revision(operation.revisao);operation.dados=S.validate(operation.dados);
    if(operation.legacy)operation.legacy=S.decode(JSON.stringify(operation.legacy));
    pending.set(key,operation);return operation;
  }
  function prepare(ctx,data,expectedRevision,key,legacy){
    guard(ctx);
    let operation=pendingOperation(ctx,key);
    if(operation&&(operation.revisao!==expectedRevision||!same(operation.dados,data)))operation=null;
    if(!operation)operation={schema:1,operacaoId:operationId(),revisao:expectedRevision,dados:copy(data),...(legacy?{legacy:copy(legacy)}:{})};
    const durable=localWrite(ctx,key,JSON.stringify(operation));
    if(legacy&&!durable)fail('A migração aguarda espaço no armazenamento deste navegador para registrar uma tentativa segura. A cópia local foi preservada.');
    pending.set(key,operation);return operation;
  }
  function forget(ctx,key,operation){
    guard(ctx);
    if(pending.get(key)?.operacaoId===operation.operacaoId)pending.delete(key);
    const current=localRead(ctx,key);
    if(current.raw!==null){try{if(JSON.parse(current.raw).operacaoId===operation.operacaoId)localRemove(ctx,key);}catch{/* Preservar controle desconhecido. */}}
  }
  function notify(ctx,record){
    guard(ctx);
    try{root.dispatchEvent(new root.CustomEvent('diamond-previsao-change',{detail:{revision:record.revision,updatedAt:record.updatedAt,status:S.STATUS}}));}catch{/* A notificação não desfaz a confirmação do sistema. */}
  }
  async function submit(ctx,operation,key,isMigration=false){
    let record;
    try{record=await request(ctx,{operacao:'salvar',revisao:operation.revisao,operacaoId:operation.operacaoId,dados:copy(operation.dados)});}
    catch(error){guard(ctx);if(isMigration&&error.status===409)forget(ctx,key,operation);throw error;}
    guard(ctx);
    if(record.revision<=operation.revisao)fail('O sistema não confirmou uma nova revisão da previsão. Tente novamente.');
    if(isMigration){
      const written=localWrite(ctx,ctx.key+':migrated',JSON.stringify({schema:1,migrated:true,operacaoId:operation.operacaoId,revision:record.revision,updatedAt:record.updatedAt,legacy:operation.legacy}));
      if(written){forget(ctx,key,operation);inspect(ctx);}
      else state(ctx).error='A migração foi confirmada no sistema, mas o controle local não pôde ser atualizado. A próxima conferência usará a mesma tentativa segura.';
    }else forget(ctx,key,operation);
    cache(ctx,record);notify(ctx,record);return record;
  }
  function merge(remote,local){
    const data=copy(remote),conflicts=[],receiptUnits=new Set();
    const partner=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
    const financialKey=(name,item)=>JSON.stringify(name==='contributions'?[partner(item.socio),item.data,item.valorCents]:[item.unitId,item.data,item.valorCents,item.natureza]);
    if(!same(data.settings,local.settings))conflicts.push('As premissas da cópia local diferem das premissas salvas no sistema.');
    for(const [name,label] of [['contributions','aporte'],['receipts','recebimento']]){
      const byId=new Map(data[name].map(item=>[item.id,item])),byFinancialKey=new Map(data[name].map(item=>[financialKey(name,item),item]));
      for(const item of local[name]){
        const existing=byId.get(item.id);
        if(existing&&!same(existing,item))conflicts.push('O '+label+' '+item.id+' possui dados diferentes no sistema.');
        else if(!existing){
          const possibleDuplicate=byFinancialKey.get(financialKey(name,item));
          if(possibleDuplicate)conflicts.push('Possível '+label+' duplicado: os registros '+possibleDuplicate.id+' e '+item.id+' têm a mesma data e valor para '+(name==='contributions'?'o mesmo sócio':'a mesma unidade e natureza')+'. Confira os dois lançamentos antes de migrar; nenhuma cópia será somada automaticamente.');
          else{data[name].push(copy(item));byId.set(item.id,item);byFinancialKey.set(financialKey(name,item),item);if(name==='contributions')data.contributionsReviewed=false;else receiptUnits.add(item.unitId);}
        }
      }
    }
    for(const [id,contract] of Object.entries(local.contracts)){
      if(Object.hasOwn(data.contracts,id)&&!same(data.contracts[id],contract))conflicts.push('A conferência do contrato '+id+' é diferente no sistema.');
      else if(!Object.hasOwn(data.contracts,id))data.contracts[id]=copy(contract);
    }
    // A união de lançamentos exige nova conferência do conjunto resultante.
    for(const unitId of receiptUnits)if(Object.hasOwn(data.contracts,unitId))data.contracts[unitId].receiptsReviewed=false;
    if(conflicts.length){const error=new Error('A cópia local tem conflitos e foi preservada. '+conflicts.join(' '));error.status=409;error.conflicts=conflicts;throw error;}
    return S.validate(data);
  }
  async function migrate(ctx,remote,info){
    guard(ctx);
    if(info.error)fail(info.error);
    if(!info.pending||!info.record)return remote;
    const key=ctx.key+':migration';
    let operation=pendingOperation(ctx,key);
    if(operation){
      if(!operation.legacy)fail('A tentativa anterior de migração não tem a origem registrada. Os dados locais foram preservados.');
    }else{
      const data=remote.revision===0?info.record.data:merge(remote.data,info.record.data);
      operation=prepare(ctx,S.validate(data),remote.revision,key,info.record);
    }
    return submit(ctx,operation,key,true);
  }
  root.DiamondPrevisaoStore={
    async load(){
      const ctx=access();
      let record=await request(ctx,{operacao:'carregar'});guard(ctx);cache(ctx,record);
      const info=inspect(ctx);
      let hasPending=false;
      try{hasPending=!!pendingOperation(ctx,ctx.key+':migration');}catch(error){state(ctx).error=error.message;}
      if(info.pending&&!state(ctx).error&&((record.revision===0&&!info.changedSinceMigration)||hasPending)){
        try{record=await migrate(ctx,record,info);guard(ctx);}catch(error){guard(ctx);Object.assign(state(ctx),{error:error.message,conflicts:copy(error.conflicts||[])});if(error.status===409){record=await request(ctx,{operacao:'carregar'});guard(ctx);cache(ctx,record);}}
      }
      guard(ctx);return copy(record);
    },
    async save(data,expectedRevision){
      const ctx=access(),normalized=S.validate(data);revision(expectedRevision);
      const key=ctx.key+':pending',operation=prepare(ctx,normalized,expectedRevision,key);
      const record=await submit(ctx,operation,key);guard(ctx);return copy(record);
    },
    async importData(json,expectedRevision){
      const ctx=access(),imported=S.decode(json);revision(expectedRevision);
      const key=ctx.key+':pending',operation=prepare(ctx,imported.data,expectedRevision,key);
      const record=await submit(ctx,operation,key);guard(ctx);return copy(record);
    },
    exportData(record){
      const ctx=access(),current=record||confirmed.get(ctx.scope);
      if(!current)fail('Carregue a previsão do sistema antes de exportar.');
      const decoded=S.decode(JSON.stringify(current));guard(ctx);return S.size(JSON.stringify(decoded));
    },
    inspectLegacy(){return inspect(access());},
    legacyStatus(){return copy(state(access()));},
    async migrateLegacy(expectedRevision){
      const ctx=access();revision(expectedRevision);
      const remote=await request(ctx,{operacao:'carregar'});guard(ctx);
      if(remote.revision!==expectedRevision)fail('A previsão mudou desde a abertura. Atualize os dados antes de migrar a cópia local.',409);
      const info=inspect(ctx);
      try{const record=await migrate(ctx,remote,info);guard(ctx);return copy(cache(ctx,record));}
      catch(error){guard(ctx);Object.assign(state(ctx),{error:error.message,conflicts:copy(error.conflicts||[])});throw error;}
    },
  };
})(typeof window!=='undefined'?window:globalThis);
