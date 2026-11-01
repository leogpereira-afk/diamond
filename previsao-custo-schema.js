/* Validação compartilhada entre navegador e API da previsão de custo. */
(function(root){
  'use strict';
  const SCHEMA=1,STATUS='Salvo no sistema',MAX_BYTES=1024*1024,MAX_CONTRACT_KEY=32768;
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
  const envelope=(revision,updatedAt,data,updatedBy)=>({schema:SCHEMA,revision,updatedAt,...(updatedBy===undefined?{}:{updatedBy}),status:STATUS,data});
  function decode(json){
    if(typeof json!=='string')fail('Informe um arquivo JSON válido.');
    size(json);
    let value;try{value=JSON.parse(json);}catch{fail('O conteúdo não é um JSON válido.');}
    keys(value,['schema','revision','updatedAt','updatedBy','status','data'],'Arquivo');
    if(value.schema!==SCHEMA)fail('Versão do arquivo não suportada. É necessário schema 1.');
    const revision=integer(value.revision,'Revisão');
    if(value.updatedAt!==null&&(typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||new Date(value.updatedAt).toISOString()!==value.updatedAt))fail('Data de atualização inválida.');
    if(revision>0&&value.updatedAt===null)fail('Data de atualização não informada.');
    const updatedBy=value.updatedBy===undefined?undefined:text(value.updatedBy,'Responsável pela atualização',200);
    return envelope(revision,value.updatedAt,validate(value.data),updatedBy);
  }
  root.DiamondPrevisaoSchema={SCHEMA,STATUS,MAX_BYTES,defaults,validate,decode,size,envelope};
})(typeof window!=='undefined'?window:globalThis);
