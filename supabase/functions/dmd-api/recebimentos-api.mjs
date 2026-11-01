import './caixa-domain.js';

// Confirmações de caixa são independentes das condições da venda. Cada mudança
// acrescenta um evento; estornar nunca apaga o recebimento original.
const canonico=v=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canonico).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonico(v[k])).join(',')+'}'):JSON.stringify(v);
const erro=(message,status=400)=>Object.assign(new Error(message),{status});
function texto(v,max,nome){if(typeof v!=='string'||v.length>max)throw erro(`${nome} inválido.`);return v.trim();}
function dia(v){
 const s=texto(v,10,'Data'),d=new Date(s+'T12:00:00Z');
 if(!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw erro('Informe uma data válida para o recebimento.');
 return s;
}
function parametros(body){
 const operacao=body.operacao,unidadeId=texto(body.unidadeId,80,'Unidade');
 const operacaoId=texto(body.operacaoId,100,'Identificador da operação');
 if(!unidadeId||!Number.isSafeInteger(body.revisao)||body.revisao<0||! /^[a-zA-Z0-9_-]{16,100}$/.test(operacaoId))throw erro('Atualize o caixa antes de confirmar a operação.');
 if(operacao==='estornar'){
  const eventoId=texto(body.eventoId,100,'Recebimento'),motivo=texto(body.motivo,600,'Motivo');
  if(!eventoId||!motivo)throw erro('Informe o recebimento e o motivo do estorno.');
  return {operacao,unidadeId,eventoId,motivo};
 }
 const parcelaId=texto(body.parcelaId,150,'Parcela'),cronogramaChave=texto(body.cronogramaChave,40000,'Cronograma');
 const valor=body.valor,data=dia(body.data),observacao=body.observacao==null?'':texto(body.observacao,600,'Observação');
 if(!parcelaId||!cronogramaChave||!Number.isSafeInteger(valor)||valor<=0||valor>1e12)throw erro('Informe a parcela e um valor positivo válido em centavos.');
 return {operacao,unidadeId,parcelaId,cronogramaChave,valor,data,observacao};
}
const autorizada=usr=>!!usr&&(usr.papel==='admin'||(usr.usuario==='domo'&&usr._ehMaster===true));
const clienteAtivo=c=>!!c&&c.ativo!==false&&!c.excluido&&!c.excluidoEm&&!c.deletedAt;
function historicoAuditavel(r,D){
 const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
 return D.validarLedger(r)&&stamp(r.atualizadoEm)&&typeof r.atualizadoPor==='string'&&!!r.atualizadoPor.trim()
  &&r.eventos.every(e=>typeof e.por==='string'&&!!e.por.trim()&&stamp(e.em)
   &&/^[a-zA-Z0-9_-]{16,100}$/.test(e.operacaoId)
   &&typeof e.solicitacao==='string'&&e.solicitacao.length>=2&&e.solicitacao.length<=50000
   &&e.fonte&&typeof e.fonte.clienteId==='string'&&!!e.fonte.clienteId.trim()
   &&typeof e.fonte.descricao==='string'&&!!e.fonte.descricao.trim()
   &&(e.fonte.vencimento===null||D.dia(e.fonte.vencimento))
   &&Number.isSafeInteger(e.fonte.valorPrevisto)&&e.fonte.valorPrevisto>0&&e.fonte.valorPrevisto<=1e12
   &&typeof e.fonte.unidade==='string'&&typeof e.fonte.cliente==='string'
   &&(e.tipo!=='estornar'||(typeof e.motivo==='string'&&!!e.motivo.trim()&&e.motivo.length<=600)));
}

export async function executarRecebimentos(body,usr,{getStore,sb,now=new Date(),uuid=()=>crypto.randomUUID()}={}){
 const result=(status,data)=>({status,data});
 if(!autorizada(usr))return result(403,{erro:'O caixa é restrito ao administrador e ao responsável da Domo.'});
 try{
  const store=getStore('vendas_recebimentos');
  if(body.operacao==='listar')return result(200,{ok:true,recebimentos:(await store.listJSON()).map(r=>r.valor)});
  if(!['confirmar','estornar'].includes(body.operacao))throw erro('Operação inválida.');
  const d=parametros(body),operacaoId=body.operacaoId.trim(),solicitacao=canonico(d),D=globalThis.DiamondCaixaDomain;
  const antigo=await store.get(d.unidadeId,{type:'json'});
  if(antigo&&(!historicoAuditavel(antigo,D)||antigo.unidadeId!==d.unidadeId))throw erro('O histórico desta unidade precisa de conferência. Nenhum recebimento foi alterado.',409);
  const repetido=antigo?.eventos.find(e=>e.operacaoId===operacaoId);
  if(repetido){
   if(repetido.solicitacao!==solicitacao)throw erro('Este identificador já foi usado em outra confirmação. Atualize o caixa.',409);
   return result(200,{ok:true,registro:antigo,repetida:true});
  }
  if((antigo?.revisao||0)!==body.revisao)throw erro('Outra pessoa atualizou os recebimentos. Atualize o caixa antes de confirmar.',409);
  if((antigo?.eventos.length||0)>=10000)throw erro('O histórico desta unidade atingiu o limite de registros. Os dados existentes foram preservados.',409);
  const hoje=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now),em=now.toISOString();
  const ativos=D.eventosAtivos(antigo),id=uuid();
  let evento,unidade=null,condicoes=null,cliente=null;
  if(d.operacao==='confirmar'){
   [unidade,condicoes]=await Promise.all([getStore('unidades').get(d.unidadeId,{type:'json'}),getStore('vendas_condicoes').get(d.unidadeId,{type:'json'})]);
   if(!unidade)throw erro('Unidade não encontrada.',404);
   const cronograma=D.cronograma(condicoes,unidade);
   if(!cronograma.ok)throw erro(cronograma.erro||'Confira as condições da venda antes de confirmar recebimentos.',409);
   if(cronograma.chave!==d.cronogramaChave)throw erro('O cronograma mudou. Atualize o caixa e confira a parcela antes de confirmar.',409);
   cliente=unidade.clienteId?await getStore('leads').get(unidade.clienteId,{type:'json'}):null;
   if(!clienteAtivo(cliente))throw erro('O comprador não está disponível no cadastro. Confira o vínculo da venda.',409);
   if(ativos.some(e=>e.cronogramaChave!==cronograma.chave))throw erro('Há recebimentos vinculados a condições anteriores. Confira o histórico antes de registrar novos recebimentos.',409);
   const parcela=cronograma.parcelas.find(p=>p.id===d.parcelaId);
   if(!parcela)throw erro('A parcela não existe neste cronograma. Atualize o caixa.',409);
   const recebido=ativos.filter(e=>e.parcelaId===d.parcelaId).reduce((s,e)=>s+e.valor,0),saldo=parcela.valor-recebido;
   if(d.valor>saldo)throw erro(saldo<=0?'Esta parcela já foi recebida. Atualize o caixa.':'O valor supera o saldo a receber da parcela. Confira o valor e atualize o caixa.',409);
   if(d.data<condicoes.data||d.data>hoje)throw erro('A data do recebimento deve ficar entre a venda e hoje.');
   evento={id,tipo:'receber',parcelaId:d.parcelaId,cronogramaChave:cronograma.chave,valor:d.valor,data:d.data,observacao:d.observacao,
    fonte:{clienteId:unidade.clienteId,descricao:parcela.descricao,vencimento:parcela.vencimento,valorPrevisto:parcela.valor,unidade:String(unidade.unidade??''),cliente:cliente.cliente||cliente.nome||cliente.nomeRazao||unidade.compradorNome||''}};
  }else{
   const original=ativos.find(e=>e.id===d.eventoId);
   if(!original)throw erro('O recebimento não foi encontrado ou já foi estornado. Atualize o caixa.',409);
   evento={id,tipo:'estornar',eventoId:original.id,parcelaId:original.parcelaId,cronogramaChave:original.cronogramaChave,valor:original.valor,data:hoje,motivo:d.motivo,fonte:original.fonte};
  }
  evento={...evento,por:usr.usuario,em,operacaoId,solicitacao};
  const registro={unidadeId:d.unidadeId,revisao:body.revisao+1,eventos:[...(antigo?.eventos||[]),evento],atualizadoEm:em,atualizadoPor:usr.usuario};
  if(!historicoAuditavel(registro,D))throw erro('Não foi possível validar a confirmação. Nenhum recebimento foi alterado.',409);
  const {data,error}=await sb.rpc('dmd_caixa_recebimento_salvar',{p_id:d.unidadeId,p_unidade_antes:unidade,p_cliente_antes:cliente,p_condicoes_antes:condicoes,p_antes:antigo||null,p_depois:registro});
  if(error)throw erro(/CONFLITO/.test(error.message||'')?'Os dados mudaram durante a confirmação. Atualize o caixa e confira o histórico antes de tentar novamente.':'Não foi possível confirmar o salvamento. Seus dados permanecem no formulário; tente novamente.',/CONFLITO/.test(error.message||'')?409:503);
  if(!data?.registro||!historicoAuditavel(data.registro,D))throw erro('O servidor não confirmou o recebimento. Atualize o caixa antes de tentar novamente.',503);
  return result(200,{ok:true,registro:data.registro,repetida:!!data.repetida});
 }catch(e){return result(e.status||503,{erro:e.status?e.message:'Não foi possível consultar ou confirmar os recebimentos. Seus dados foram preservados; tente novamente.'});}
}
