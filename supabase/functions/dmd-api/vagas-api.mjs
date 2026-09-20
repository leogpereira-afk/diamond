import { sb } from '../_shared/blobs-shim.mjs';
import './vagas-domain.js';
export async function executarVagas(b,usr,json){
const V=globalThis.DomoVagas,acao=b.operacao;const reply=(dados,status=200)=>json(status,dados.error?{...dados,erro:dados.error}:dados);
try{
    const {data:row,error}=await sb.from('domo_vagas_estado').select('estado,revisao,atualizado_em').eq('obra','diamond').maybeSingle();
    if(error)throw Error('Não foi possível consultar o espelho.');
    if(!row)return reply({error:'O espelho ainda não foi importado.'},404);
    if(acao==='carregar')return reply({ok:true,...row});
    if(!['salvar','preverImportacao','importar'].includes(acao))return reply({error:'Ação inválida'},400);
    if(row.estado.sync?.pendente)return reply({error:'A planilha está confirmando uma atualização. Aguarde a sincronização antes de alterar os dados.'},409);
    const estado=structuredClone(row.estado);
    const por=usr.nome||usr.usuario;
    let novo=estado,detalhe;
    if(acao==='salvar'){
      const ajuste=V.validarAjuste(b.codigo,b.ajuste||{},estado);
      detalhe={vaga:b.codigo,antes:V.efetivas(estado).find((v)=>v.codigo===b.codigo),depois:ajuste,motivo:ajuste.motivo};
      novo.ajustes={...(estado.ajustes||{}),[b.codigo]:ajuste};
    }else{
      if(usr.papel!=='admin')return reply({error:'Somente a direção pode importar uma planilha.'},403);
      const imp=V.importar({...b.fonte,lidoEm:new Date().toISOString()});
      novo={...imp,ajustes:estado.ajustes||{},historico:estado.historico||[],fonte:{...imp.fonte,tipo:'Planilha importada'}};
      const mudaram=imp.vagas.filter((v)=>v.assinatura!==estado.vagas.find((x)=>x.codigo===v.codigo)?.assinatura).map((v)=>v.codigo);
      if(acao==='preverImportacao')return reply({ok:true,mudaram,alertas:V.efetivas(novo).filter((v)=>v.alertas.length).length,revisao:row.revisao});
      detalhe={motivo:'Importação de planilha conferida',vagasAlteradas:mudaram,fonteAnterior:estado.fonte,fonteNova:novo.fonte};
    }
    if(!Number.isSafeInteger(b.revisao)||b.revisao!==row.revisao)return reply({error:'Outra pessoa atualizou o espelho. Atualize e confira antes de salvar.',conflito:true},409);
    novo.historico=[...(estado.historico||[]),{id:crypto.randomUUID(),em:new Date().toISOString(),por,acao,...detalhe}];
    const {data:revisao,error:e}=await sb.rpc('domo_vagas_salvar',{p_revisao:b.revisao,p_estado:novo});
    if(e){if(e.message.includes('VAGAS_CONFLITO'))return reply({error:'O espelho mudou durante a gravação. Atualize e confira novamente.',conflito:true},409);throw Error('Não foi possível salvar. Tente novamente.');}
    return reply({ok:true,revisao,estado:novo,atualizado_em:new Date().toISOString()});
}catch(e){return json(400,{erro:e.message||'Não foi possível concluir.'})}
}
