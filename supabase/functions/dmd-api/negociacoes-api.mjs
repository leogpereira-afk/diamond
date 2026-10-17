// Área interna Domo. Usa os cadastros existentes; nenhuma cópia de proposta.
export async function executarNegociacoes(body, usr, {getStore,sb,uuid=()=>crypto.randomUUID()}) {
 const result=(status,data)=>({status,data});
 if(!usr || !(usr.usuario==='domo'||usr.papel==='admin'))return result(403,{erro:'Área exclusiva da Domo.'});
 const cfg=getStore('cfg'),store=getStore('negociacoes');
 const contas=await cfg.get('usuarios',{type:'json'})||[];
 const domo=contas.find(u=>u.usuario==='domo');
 const equipe=[...new Set((domo?.corretores||[]).map(c=>c.nome).filter(Boolean))];
 const propostas=(await getStore('propostas').listJSON()).filter(x=>x.valor?.corretorUsuario==='domo').map(({key,valor:p})=>({id:key,cliente:p.cliente||'',unidade:p.unidade||'',valor:p.neg??p.valor??null}));
 if(body.operacao==='listar')return result(200,{ok:true,equipe,propostas,negociacoes:(await store.listJSON()).map(x=>x.valor).sort((a,b)=>b.atualizado.localeCompare(a.atualizado))});
 if(body.operacao!=='salvar')return result(400,{erro:'Operação inválida.'});
 const d=body.dados||{},etapas=['analise','proposta','negociacao','decisao','concluida','cancelada'];
 const titulo=String(d.titulo||'').trim(),acao=String(d.acao||'').trim(),nota=String(d.nota||'').trim();
 const fim=['concluida','cancelada'].includes(d.etapa);
 const data=String(d.prazo||'');
 if(!titulo||titulo.length>160||!etapas.includes(d.etapa)||!equipe.includes(d.responsavel)||!nota||nota.length>2000||acao.length>500)return result(400,{erro:'Preencha título, responsável da Domo, etapa e registro da ação (até 2.000 caracteres).'});
 if(!fim&&(!acao||!data))return result(400,{erro:'Defina a próxima ação e seu prazo.'});
 if(data&&(!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data))||new Date(data).toISOString().slice(0,10)!==data))return result(400,{erro:'Prazo inválido.'});
 const propostaId=String(d.propostaId||'');
 if(propostaId&&!propostas.some(p=>p.id===propostaId))return result(400,{erro:'Selecione uma proposta da Domo.'});
 const id=body.id||uuid();
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(id)||!Number.isInteger(body.revisao)||body.revisao<0)return result(400,{erro:'Registro ou revisão inválida.'});
 const antes=await store.get(id,{type:'json'});
 if((antes?.revisao||0)!==body.revisao)return result(409,{erro:'Outra pessoa atualizou esta negociação. Atualize a lista antes de salvar.'});
 const em=new Date().toISOString();
 const evento={id:uuid(),em,por:usr.usuario,perfil:usr.nome||usr.usuario,nota,etapa:d.etapa,responsavel:d.responsavel,acao:fim?'':acao,prazo:fim?'':data};
 const registro={id,titulo,propostaId,etapa:d.etapa,responsavel:d.responsavel,acao:evento.acao,prazo:evento.prazo,criado:antes?.criado||em,atualizado:em,revisao:body.revisao+1,historico:[...(antes?.historico||[]),evento]};
 const {error}=await sb.rpc('dmd_negociacao_salvar',{p_id:id,p_revisao:body.revisao,p_registro:registro});
 if(error)return result(error.message?.includes('NEGOCIACAO_CONFLITO')?409:503,{erro:error.message?.includes('NEGOCIACAO_CONFLITO')?'Outra pessoa atualizou esta negociação. Atualize a lista.':'Não foi possível salvar na nuvem. Seus campos continuam na tela.'});
 return result(200,{ok:true,registro});
}
