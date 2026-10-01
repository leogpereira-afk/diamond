/* Regras de leitura para o painel de gestão Diamond. */
(function(root){
  const todaySP=(value=new Date())=>{
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
    const o=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return `${o.year}-${o.month}-${o.day}`;
  };
  const dateSP=value=>{
    if(!value)return '';
    const s=String(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
      const [y,m,d]=s.split('-').map(Number),check=new Date(Date.UTC(y,m-1,d));
      return check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d?s:'';
    }
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'':todaySP(d);
  };
  const when=(value,today)=>{
    const day=dateSP(value);
    return !day?'sem-data':day<today?'vencido':day===today?'hoje':'futuro';
  };
  const back=visao=>`#/admin/painel?visao=${encodeURIComponent(visao)}`;
  const routes={
    proposal:(id,visao='resumo')=>`#/proposta/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    unit:(id,visao='compradores')=>`#/conexoes/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    customer:(id,visao='retornos')=>`#/cliente/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    reservation:(filtro,id='')=>`#/admin/reservas?filtro=${encodeURIComponent(filtro)}${id?'&unidade='+encodeURIComponent(id):''}`,
    envio:id=>`#/admin/envios?envio=${encodeURIComponent(id)}&fila=pendente`,
  };
  function build({unidades=[],pedidos=[],leads=[],envios=[],propostas=[],now=new Date()}={}){
    const hoje=todaySP(now),resUn=unidades.filter(u=>u.status==='Reservado');
    const vencidas=resUn.filter(u=>u.reserva?.prazo&&Date.parse(u.reserva.prazo)<=now.getTime());
    const semPrazo=resUn.filter(u=>!u.reserva?.prazo||!Number.isFinite(Date.parse(u.reserva.prazo)));
    const ativas=resUn.filter(u=>!vencidas.includes(u)&&!semPrazo.includes(u));
    const retornosCRM=leads.filter(l=>!['fechado','perdido'].includes(l.estagio)&&l.proximoContato&&when(l.proximoContato,hoje)!=='futuro');
    const retornosEnvios=envios.filter(e=>['pendente','contato'].includes(e.acompanhamento?.etapa)&&when(e.acompanhamento?.data,hoje)!=='futuro');
    const compradores=unidades.filter(u=>u.status==='Vendido').slice().sort((a,b)=>String(a.unidade||'').localeCompare(String(b.unidade||''),'pt-BR',{numeric:true})).map(u=>({unidade:u,comprador:String(u.compradorNome||'').trim()}));
    return {
      hoje, estoque:{disponiveis:unidades.filter(u=>u.status==='Disponível').length,reservadas:resUn.length,vendidas:unidades.filter(u=>u.status==='Vendido').length,total:unidades.length},
      pedidos, reservas:{vencidas,semPrazo,ativas}, retornosCRM, retornosEnvios, compradores, totalEnvios:envios.length,
      propostas:propostas.slice().sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||''))),
    };
  }
  root.DiamondGestaoDomain={todaySP,dateSP,when,build,routes};
})(typeof window!=='undefined'?window:globalThis);
