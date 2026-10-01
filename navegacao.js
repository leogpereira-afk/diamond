/* Entradas estáveis para a gestão, sem ampliar as permissões de cada área. */
(function(root){
  const entries=[['painel','Painel','◫'],['vendas','Unidades e vendas','▦'],['reservas','Reservas','◷'],['clientes','Clientes','♙'],['historico','Propostas','▤'],['envios','Envios','↗'],['vagas','Garagem','▥'],['corretores','Corretores','♧']];
  const admin=[['unidades','Preços e unidades'],['predio','Empreendimento'],['config','Configurações'],['saude','Diagnóstico']];
  function active(hash){const route=String(hash||'').split('?')[0];if(route.startsWith('#/admin/'))return route.slice(8);if(route.startsWith('#/proposta/'))return 'historico';if(route.startsWith('#/cliente/')||route==='#/clientes')return 'clientes';if(route.startsWith('#/conexoes/'))return 'vendas';return '';}
  function html({allowed=false,isAdmin=false,hash=''}={}){
    if(!allowed)return '';
    const current=active(hash),link=([key,label,icon])=>`<a href="#/admin/${key}"${key===current?' aria-current="page"':''}>${icon?`<span aria-hidden="true">${icon}</span>`:''}${label}</a>`;
    const title=entries.concat(admin).find(([key])=>key===current)?.[1]||'Navegação';
    return `<details class="gestao-nav" open><summary>☰ ${title}<span>Menu de gestão</span></summary><nav aria-label="Gestão Diamond"><a href="#/home"${hash==='#/home'?' aria-current="page"':''}><span aria-hidden="true">◇</span>Espelho</a>${entries.map(link).join('')}${isAdmin?`<details class="gestao-config"><summary>Configurações</summary><div>${admin.map(link).join('')}</div></details>`:''}</nav></details>`;
  }
  root.DiamondNavegacao={html,active};
})(typeof window!=='undefined'?window:globalThis);
