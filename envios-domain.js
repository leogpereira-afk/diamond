// Regras de leitura compartilhadas pela lista e por seus testes.
(function(root){
  const text=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const count=(e,t)=>(e.eventos||[]).filter(x=>x.tipo===t).length;
  const labels={interesse:'Interesse registrado',duvida:'Dúvida registrada',abriu_pdf:'PDF aberto',abertura:'Link aberto',criacao:'Link criado'};
  const filas=new Set(['','interesse','duvida','sem','conferir','pendente']);
  function readRoute(hash){const [path,query='']=String(hash||'#/admin/envios').split('?'),p=new URLSearchParams(query);const fila=p.get('fila')??'';return{path,envio:p.get('envio')||'',fila:filas.has(fila)?fila:'',filaExplicit:p.has('fila'),q:p.get('q')||''};}
  function writeRoute(hash,{fila,q,dropEnvio=false}={}){const r=readRoute(hash),p=new URLSearchParams(String(hash||'').split('?')[1]||'');if(fila!==undefined)p.set('fila',fila);if(q!==undefined){if(q)p.set('q',q);else p.delete('q');}if(dropEnvio)p.delete('envio');const query=p.toString();return r.path+(query?'?'+query:'');}
  function resetControls(host){for(const key of ['q','de','ate','corretor','empresa','modalidade']){const el=host?.querySelector('#env-'+key);if(el)el.value='';}return{fila:'',q:''};}
  function activity(e){return [{tipo:'criacao',em:e.em},...(e.lastView?[{tipo:'abertura',em:e.lastView}]:[]),...(e.eventos||[])].filter(x=>Number.isFinite(Date.parse(x.em))).sort((a,b)=>Date.parse(b.em)-Date.parse(a.em))[0]||{tipo:'criacao',em:e.em};}
  function issues(e,all){const out=[];if(!e.propostaId)out.push('Proposta sem referência');else if(e.vinculos?.proposta===false)out.push('Proposta não localizada no servidor');if(!e.leadId)out.push('Cliente sem referência');else if(e.vinculos?.cliente===false)out.push('Cliente não localizado no servidor');if((e.cliente||'').trim().length<3||/\bteste\b/i.test(e.cliente||''))out.push('Conferir nome do cliente');if(e.numero&&all.filter(x=>x.numero===e.numero).length>1)out.push('Número antigo repetido; use a referência');return out;}
  function filter(all,f={}){return all.filter(e=>{
    const day=new Date(e.em).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    if(f.de&&day<f.de||f.ate&&day>f.ate)return false;
    if(f.corretor&&e.corretor!==f.corretor||f.empresa&&e.empresa!==f.empresa||f.modalidade&&(e.resumo?.modalidade||'Sem resumo')!==f.modalidade)return false;
    if(f.q&&!text([e.numero,e.id,e.cliente,e.unidade,e.corretor,e.empresa].join(' ')).includes(text(f.q).trim()))return false;
    if(f.fila==='pendente'&&!['pendente','contato'].includes(e.acompanhamento?.etapa))return false;
    if(f.fila==='interesse'&&!count(e,'interesse')||f.fila==='duvida'&&!count(e,'duvida')||f.fila==='sem'&&(Number(e.views)||count(e,'abriu_pdf')||count(e,'interesse')||count(e,'duvida'))||f.fila==='conferir'&&!issues(e,all).length)return false;
    return true;
  }).sort((a,b)=>Date.parse(activity(b).em)-Date.parse(activity(a).em));}
  root.DiamondEnviosDomain={count,activity,issues,filter,labels,readRoute,writeRoute,resetControls};
})(typeof window!=='undefined'?window:globalThis);
