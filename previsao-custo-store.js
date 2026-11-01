/* Registro privado da previsão: persiste somente neste navegador, sem fila/API. */
(function(root){
  'use strict';
  const SCHEMA=1,STATUS='Salvo neste navegador',MAX_BYTES=1024*1024,MAX_CONTRACT_KEY=32768;
  const PREFIX='dv_previsao_custo_v1:';
  const fail=message=>{throw new Error(message);};
  const object=(v,label)=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.prototype.toString.call(v)!=='[object Object]')fail(label+' inválido.');
    return v;
  };
  function keys(value,allowed,label){
    object(value,label);
    if(Object.keys(value).some(key=>!allowed.includes(key)))fail(label+' contém campos desconhecidos.');
  }
  function text(value,label,max,optional=false){
    if(optional&&value==null)return '';
    if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(!optional&&!value.trim()))fail(label+' inválido.');
    return value.trim();
  }
  function id(value,label){
    const result=text(value,label,160);
    if(['__proto__','constructor','prototype'].includes(result)||/[\r\n\t]/.test(result))fail(label+' inválido.');
    return result;
  }
  function integer(value,label){
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail(label+' deve ser um inteiro não negativo.');
    return value;
  }
  function fraction(value,label,nullable=false){
    if(nullable&&value===null)return null;
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)fail(label+' deve estar entre 0 e 1.');
    return value;
  }
  function bool(value,label,missing=false){
    if(value===undefined)return missing;
    if(typeof value!=='boolean')fail(label+' inválido.');
    return value;
  }
  function day(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))fail('Informe uma data existente no formato AAAA-MM-DD.');
    const parsed=new Date(value+'T12:00:00Z');
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail('Informe uma data existente no formato AAAA-MM-DD.');
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
    if(value>today)fail('Informe somente aportes e recebimentos realizados até hoje, no horário de Brasília.');
    return value;
  }
  function array(value,label,max){
    if(!Array.isArray(value)||value.length>max)fail(label+' deve ser uma lista com até '+max+' registros.');
    for(let index=0;index<value.length;index++)if(!Object.hasOwn(value,index))fail(label+' contém uma posição vazia.');
    return value;
  }
  function unique(values,label){
    if(new Set(values).size!==values.length)fail(label+' contém identificadores duplicados.');
  }
  function size(json){
    let bytes=0;
    for(const char of json){const code=char.codePointAt(0);bytes+=code<128?1:code<2048?2:code<65536?3:4;if(bytes>MAX_BYTES)fail('O registro excede o limite de 1 MB.');}
    return json;
  }
  const defaults=()=>({settings:{targetCents:1700000000,futurePaymentShare:.5,futureCommissionRate:null},contributionsReviewed:false,contributions:[],contracts:{},receipts:[]});
  function validate(data){
    keys(data,['settings','contributionsReviewed','contributions','contracts','receipts'],'Registro');
    keys(data.settings,['targetCents','futurePaymentShare','futureCommissionRate'],'Configuração');
    const settings={targetCents:integer(data.settings.targetCents,'Custo previsto'),futurePaymentShare:fraction(data.settings.futurePaymentShare,'Participação futura'),futureCommissionRate:fraction(data.settings.futureCommissionRate,'Comissão futura',true)};
    if(settings.targetCents===0)fail('Custo previsto deve ser maior que zero.');
    const contributions=array(data.contributions,'Aportes',5000).map(c=>{
      keys(c,['id','socio','data','valorCents','observacao'],'Aporte');
      return {id:id(c.id,'Identificador do aporte'),socio:text(c.socio,'Sócio',200),data:day(c.data),valorCents:integer(c.valorCents,'Valor do aporte'),observacao:text(c.observacao,'Observação do aporte',2000,true)};
    });
    unique(contributions.map(c=>c.id),'Aportes');
    object(data.contracts,'Contratos');
    if(Object.keys(data.contracts).length>1000)fail('Informe até 1000 contratos.');
    const contracts={};
    for(const [unit,c] of Object.entries(data.contracts)){
      const unitId=id(unit,'Identificador da unidade');
      if(unitId!==unit)fail('O identificador da unidade não pode conter espaços nas extremidades.');
      keys(c,['contractKey','commissionCents','finalSeriesIndices','receiptsReviewed'],'Contrato');
      const finalSeriesIndices=array(c.finalSeriesIndices,'Séries finais',600).map(v=>integer(v,'Índice da série'));
      if(finalSeriesIndices.some(v=>v>599))fail('O índice da série deve estar entre 0 e 599.');
      unique(finalSeriesIndices,'Séries finais');
      contracts[unitId]={contractKey:text(c.contractKey,'Referência do contrato',MAX_CONTRACT_KEY),commissionCents:c.commissionCents==null?null:integer(c.commissionCents,'Comissão contratual'),finalSeriesIndices,receiptsReviewed:bool(c.receiptsReviewed,'Conferência dos recebimentos')};
    }
    const receipts=array(data.receipts,'Recebimentos',10000).map(r=>{
      keys(r,['id','unitId','contractKey','data','valorCents','natureza','observacao'],'Recebimento');
      if(!['comum','final'].includes(r.natureza))fail('A natureza do recebimento deve ser comum ou final.');
      return {id:id(r.id,'Identificador do recebimento'),unitId:id(r.unitId,'Identificador da unidade'),contractKey:text(r.contractKey,'Referência do contrato',MAX_CONTRACT_KEY),data:day(r.data),valorCents:integer(r.valorCents,'Valor recebido'),natureza:r.natureza,observacao:text(r.observacao,'Observação do recebimento',2000,true)};
    });
    unique(receipts.map(r=>r.id),'Recebimentos');
    const normalized={settings,contributionsReviewed:bool(data.contributionsReviewed,'Conferência dos aportes'),contributions,contracts,receipts};
    size(JSON.stringify(normalized));
    return normalized;
  }
  function access(){
    const store=root.STORE;
    if(!store||typeof store.podeVerPainel!=='function'||!store.podeVerPainel())fail('Acesso restrito à gestão Diamond.');
    const user=store.getUser?.();
    if(!user||typeof user.usuario!=='string'||!user.usuario.trim())fail('Sessão inválida. Entre novamente.');
    const origin=String(root.location?.origin||'origem-local');
    let storage;try{storage=root.localStorage;}catch{fail('O armazenamento deste navegador está bloqueado.');}
    return {key:PREFIX+encodeURIComponent(origin)+':'+encodeURIComponent(user.usuario),storage};
  }
  const envelope=(revision,updatedAt,data)=>({schema:SCHEMA,revision,updatedAt,status:STATUS,data});
  function decode(json){
    if(typeof json!=='string')fail('Informe um arquivo JSON válido.');
    size(json);
    let value;try{value=JSON.parse(json);}catch{fail('O conteúdo não é um JSON válido.');}
    keys(value,['schema','revision','updatedAt','status','data'],'Arquivo');
    if(value.schema!==SCHEMA)fail('Versão do arquivo não suportada. É necessário schema 1.');
    const revision=integer(value.revision,'Revisão');
    if(value.updatedAt!==null&&(typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||new Date(value.updatedAt).toISOString()!==value.updatedAt))fail('Data de atualização inválida.');
    if(revision>0&&value.updatedAt===null)fail('Data de atualização não informada.');
    return envelope(revision,value.updatedAt,validate(value.data));
  }
  function read(accessed){
    let raw;try{raw=accessed.storage.getItem(accessed.key);}catch{fail('Não foi possível ler o armazenamento deste navegador.');}
    if(raw===null)return {raw:null,record:envelope(0,null,defaults())};
    try{return {raw,record:decode(raw)};}catch(error){fail('O registro local está inválido e foi preservado. Não será sobrescrito. '+error.message);}
  }
  function write(accessed,data,expectedRevision){
    integer(expectedRevision,'Revisão esperada');
    const normalized=validate(data),previous=read(accessed);
    if(previous.record.revision!==expectedRevision)fail('A previsão mudou desde a abertura. Atualize os dados antes de salvar.');
    if(expectedRevision===Number.MAX_SAFE_INTEGER)fail('O limite de revisões deste registro foi atingido.');
    const record=envelope(expectedRevision+1,new Date().toISOString(),normalized),json=size(JSON.stringify(record));
    let current;try{current=accessed.storage.getItem(accessed.key);}catch{fail('Não foi possível conferir o registro local antes de salvar.');}
    if(current!==previous.raw)fail('A previsão mudou durante a edição. Atualize os dados antes de salvar.');
    try{accessed.storage.setItem(accessed.key,json);}catch{fail('Não foi possível salvar neste navegador. O registro anterior foi preservado. Verifique o espaço de armazenamento e tente novamente.');}
    try{root.dispatchEvent(new root.CustomEvent('diamond-previsao-change',{detail:{revision:record.revision,updatedAt:record.updatedAt,status:STATUS}}));}catch{/* A notificação não desfaz a gravação já concluída. */}
    return record;
  }
  root.DiamondPrevisaoStore={
    load(){return read(access()).record;},
    save(data,expectedRevision){return write(access(),data,expectedRevision);},
    exportData(){return size(JSON.stringify(read(access()).record));},
    importData(json,expectedRevision){const accessed=access(),imported=decode(json);return write(accessed,imported.data,expectedRevision);},
  };
})(typeof window!=='undefined'?window:globalThis);
