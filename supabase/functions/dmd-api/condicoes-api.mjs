import { tabelasDaVenda } from './condicoes-tabelas.mjs';
// Condições nominais contratadas. Não representa recebimentos ou quitação.
const canonico=value=>value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonico).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonico(value[k])).join(',')+'}'):JSON.stringify(value);
const texto=(v,max=600)=>String(v??'').trim().slice(0,max);
const centavos=(v)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1e12)throw Error('Informe valores válidos em centavos.');return v;};
function dia(v){const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)throw Error('Informe uma data válida.');return s;}
export function validarCondicoes(d,hoje){
 const total=centavos(d.total),entrada=centavos(d.entrada);if(!total)throw Error('O valor contratado deve ser maior que zero.');
 const data=dia(d.data);if(data>hoje)throw Error('A data da venda não pode ser futura.');
 if(!Array.isArray(d.permutas)||d.permutas.length>20||!Array.isArray(d.parcelas)||d.parcelas.length>20)throw Error('Informe até 20 permutas e 20 séries de parcelas.');
 const permutas=d.permutas.map(p=>{const descricao=texto(p.descricao,300),valor=centavos(p.valor);if(!descricao||!valor)throw Error('Descreva e informe o valor de cada permuta.');return{descricao,valor};});
 const parcelas=d.parcelas.map(p=>{const descricao=texto(p.descricao,100),valor=centavos(p.valor),quantidade=p.quantidade,intervalo=p.intervalo;if(!descricao||!valor||!Number.isInteger(quantidade)||quantidade<1||quantidade>600||!Number.isInteger(intervalo)||intervalo<1||intervalo>120)throw Error('Confira descrição, quantidade, valor e intervalo das parcelas.');const primeiro=dia(p.primeiro);if(primeiro<data)throw Error('O primeiro vencimento não pode anteceder a venda.');return{descricao,valor,quantidade,intervalo,primeiro};});
 const soma=entrada+permutas.reduce((n,p)=>n+p.valor,0)+parcelas.reduce((n,p)=>n+p.valor*p.quantidade,0);
 if(soma>total)throw Error('Entrada, permutas e parcelas precisam fechar exatamente o valor contratado, sem ultrapassar esse total.');
 if(soma!==total&&d.composicaoPendente!==true)throw Error('Entrada, permutas e parcelas precisam fechar exatamente o valor contratado. Para preencher depois, marque a composição pendente.');
 return {total,entrada,data,permutas,parcelas,composicaoPendente:soma<total,saldoAInformar:total-soma,observacoes:texto(d.observacoes,2000),correcao:texto(d.correcao,200)};
}
async function carregarTabelas(getStore,u){
 const [cfg,historico]=await Promise.all([getStore('cfg').get('cfg',{type:'json'}),getStore('precos_historico').listJSON()]);
 const ordenado=historico.filter(r=>r?.valor).sort((a,z)=>String(z.valor.criadoEm).localeCompare(String(a.valor.criadoEm)));
 return tabelasDaVenda(u,cfg,ordenado);
}
export async function executarCondicoes(body,usr,{getStore,sb,salvar,now=new Date()}={}){
 const result=(status,data)=>({status,data});
 if(!usr||!(usr.usuario==='domo'||usr.papel==='admin'))return result(403,{erro:'Acesso restrito à gestão Diamond.'});
 const store=getStore('vendas_condicoes');
 if(body.operacao==='listar')return result(200,{ok:true,condicoes:(await store.listJSON()).map(r=>r.valor)});
 if(!['carregar','salvar'].includes(body.operacao))return result(400,{erro:'Operação inválida.'});
 try{
  const id=texto(body.unidadeId,80);
  if(!id)throw Error('Unidade inválida.');
  const u=await getStore('unidades').get(id,{type:'json'});
  if(!u)return result(404,{erro:'Unidade não encontrada.'});
  const antigo=await store.get(id,{type:'json'});
  if(body.operacao==='carregar'){
   const opcoes=await carregarTabelas(getStore,u);
   return result(200,{ok:true,unidade:u,condicao:antigo||null,tabelas:opcoes.map(o=>o.tabela)});
  }
  if(!Number.isInteger(body.revisao)||body.revisao<0)throw Error('Revisão inválida.');
  if(u.status!=='Vendido')throw Error('As condições são registradas somente para unidades vendidas.');
  if(!u.atualizadoEm||body.unidadeRevisao!==u.atualizadoEm)return result(409,{erro:'A unidade mudou. Atualize o painel antes de salvar.'});
  const cliente=u.clienteId?await getStore('leads').get(u.clienteId,{type:'json'}):null;
  if(!cliente)throw Error('Vincule o comprador no cadastro da unidade antes de registrar as condições.');
  const hoje=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now);
  const dados=validarCondicoes(body.dados||{},hoje);
  if((antigo?.revisao||0)!==body.revisao)return result(409,{erro:'Outra pessoa atualizou as condições. Atualize o painel.'});
  let tabelaVenda=antigo?.tabelaVenda||null,fonte=null;
  if(Object.hasOwn(body,'tabelaSelecao')){
   if(body.tabelaSelecao===null)tabelaVenda=null;
   else{
    const key=typeof body.tabelaSelecao==='string'?body.tabelaSelecao:body.tabelaSelecao?.key;
    const escolhas=await carregarTabelas(getStore,u),escolha=escolhas.find(o=>o.tabela.key===key);
    if(!escolha)throw Error('A tabela escolhida não está disponível para esta unidade. Atualize as opções.');
    if(body.tabelaSelecao&&typeof body.tabelaSelecao==='object'&&Object.hasOwn(body.tabelaSelecao,'esperada')&&canonico(body.tabelaSelecao.esperada)!==canonico(escolha.tabela))return result(409,{erro:'A tabela mudou desde que você abriu a edição. Atualize as opções e confira os valores antes de salvar.'});
    tabelaVenda=escolha.tabela;fonte=escolha.fonte;
   }
  }
  const registro={...dados,tabelaVenda,unidadeId:id,clienteId:u.clienteId,unidadeRevisao:u.atualizadoEm,revisao:body.revisao+1,atualizadoEm:now.toISOString(),por:usr.usuario,historico:[...(antigo?.historico||[]),...(antigo?[{...antigo,historico:undefined}]:[])]};
  let ok;
  if(salvar)ok=await salvar(id,body.revisao,registro,{unidade:u,cliente,antigo,fonte});
  else{
   const {error}=await sb.rpc('dmd_venda_condicoes_salvar',{p_id:id,p_unidade_antes:u,p_cliente_antes:cliente,p_antes:antigo||null,p_depois:registro,p_fonte_store:fonte?.store||null,p_fonte_key:fonte?.key||null,p_fonte_antes:fonte?.valor||null});
   if(error){
    if(/CONFLITO/.test(error.message||''))return result(409,{erro:'A unidade, o comprador, as condições ou a tabela mudaram durante a edição. Atualize antes de salvar.'});
    return result(503,{erro:'Não foi possível confirmar o salvamento. Seus dados permanecem no formulário; tente novamente.'});
   }
   ok=true;
  }
  return ok?result(200,{ok:true,registro}):result(409,{erro:'As condições mudaram durante a edição. Atualize o painel.'});
 }catch(e){return result(400,{erro:e.message});}
}
