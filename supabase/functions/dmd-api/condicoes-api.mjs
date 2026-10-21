// Condições nominais contratadas. Não representa recebimentos ou quitação.
const texto=(v,max=600)=>String(v??'').trim().slice(0,max);
const centavos=(v)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1e12)throw Error('Informe valores válidos em centavos.');return v;};
function dia(v){const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)throw Error('Informe uma data válida.');return s;}
export function validarCondicoes(d,hoje){
 const total=centavos(d.total),entrada=centavos(d.entrada);if(!total)throw Error('O valor contratado deve ser maior que zero.');
 const data=dia(d.data);if(data>hoje)throw Error('A data da venda não pode ser futura.');
 if(!Array.isArray(d.permutas)||d.permutas.length>20||!Array.isArray(d.parcelas)||d.parcelas.length>20)throw Error('Informe até 20 permutas e 20 séries de parcelas.');
 const permutas=d.permutas.map(p=>{const descricao=texto(p.descricao,300),valor=centavos(p.valor);if(!descricao||!valor)throw Error('Descreva e informe o valor de cada permuta.');return {descricao,valor};});
 const parcelas=d.parcelas.map(p=>{const descricao=texto(p.descricao,100),valor=centavos(p.valor),quantidade=p.quantidade,intervalo=p.intervalo;
 if(!descricao||!valor||!Number.isInteger(quantidade)||quantidade<1||quantidade>600||!Number.isInteger(intervalo)||intervalo<1||intervalo>120)throw Error('Confira descrição, quantidade, valor e intervalo das parcelas.');
 const primeiro=dia(p.primeiro);if(primeiro<data)throw Error('O primeiro vencimento não pode anteceder a venda.');return {descricao,valor,quantidade,intervalo,primeiro};});
 const soma=entrada+permutas.reduce((n,p)=>n+p.valor,0)+parcelas.reduce((n,p)=>n+p.valor*p.quantidade,0);
 if(soma!==total)throw Error('Entrada, permutas e parcelas precisam fechar exatamente o valor contratado.');
 return {total,entrada,data,permutas,parcelas,observacoes:texto(d.observacoes,2000),correcao:texto(d.correcao,200)};
}
export async function executarCondicoes(body,usr,{getStore,sb,salvar,now=new Date()}={}){
 const result=(status,data)=>({status,data});
 if(!usr||!(usr.usuario==='domo'||usr.papel==='admin'))return result(403,{erro:'Acesso restrito à gestão Diamond.'});
 const store=getStore('vendas_condicoes');
 if(body.operacao==='listar')return result(200,{ok:true,condicoes:(await store.listJSON()).map(r=>r.valor)});
 if(body.operacao!=='salvar')return result(400,{erro:'Operação inválida.'});
 try{
  const id=texto(body.unidadeId,80);if(!id||!Number.isInteger(body.revisao)||body.revisao<0)throw Error('Unidade ou revisão inválida.');
  const u=await getStore('unidades').get(id,{type:'json'});
  if(!u||u.status!=='Vendido')throw Error('As condições são registradas somente para unidades vendidas.');
  if(!u.atualizadoEm||body.unidadeRevisao!==u.atualizadoEm)return result(409,{erro:'A unidade mudou. Atualize o painel antes de salvar.'});
  if(!u.clienteId||!await getStore('leads').get(u.clienteId,{type:'json'}))throw Error('Vincule o comprador no cadastro da unidade antes de registrar as condições.');
  const hoje=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now);
  const dados=validarCondicoes(body.dados||{},hoje);
  const antigo=await store.get(id,{type:'json'});
  if((antigo?.revisao||0)!==body.revisao)return result(409,{erro:'Outra pessoa atualizou as condições. Atualize o painel.'});
  const registro={...dados,unidadeId:id,clienteId:u.clienteId,unidadeRevisao:u.atualizadoEm,revisao:body.revisao+1,atualizadoEm:now.toISOString(),por:usr.usuario,historico:[...(antigo?.historico||[]),...(antigo?[{...antigo,historico:undefined}]:[])]};
  let ok;
  if(salvar)ok=await salvar(id,body.revisao,registro);
  else if(body.revisao===0){const {error}=await sb.from('dmd_kv').insert({store:'vendas_condicoes',key:id,valor:registro});if(error&&error.code!=='23505')throw Error('Não foi possível salvar. Tente novamente.');ok=!error;}
  else {const {data,error}=await sb.from('dmd_kv').update({valor:registro,atualizado_em:now.toISOString()}).eq('store','vendas_condicoes').eq('key',id).eq('valor->>revisao',String(body.revisao)).select('key');if(error)throw Error('Não foi possível salvar. Tente novamente.');ok=data?.length===1;}
  return ok?result(200,{ok:true,registro}):result(409,{erro:'As condições mudaram durante a edição. Atualize o painel.'});
 }catch(e){return result(400,{erro:e.message});}
}
