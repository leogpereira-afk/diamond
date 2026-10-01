/* Diretório de atendimento. Identidade é o id do CRM, nunca nome semelhante. */
(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const stages={novo:'Novo',contato:'Em contato',proposta:'Com proposta',negociando:'Negociando',fechado:'Fechado no CRM',perdido:'Perdido'};
 let filter={q:'',etapa:'',corretor:''},generation=0;
 async function render(){
  if(!STORE.podeVerPainel())return;
  const host=document.getElementById('aba-corpo');let route=location.hash;const params=new URLSearchParams(route.split('?')[1]||''),queryStage=params.get('etapa');if(Object.hasOwn(stages,queryStage)){filter={q:'',etapa:queryStage,corretor:''};}const gen=++generation;
  host.innerHTML='<p role="status">Consultando cadastros de clientes…</p>';
  let leads;
  try{const r=await STORE.api('listLeads',{comoCorretor:STORE.getUser()?.corretorAtivo?.nome||''});if(!Array.isArray(r.leads))throw Error('Não foi possível consultar os clientes.');leads=r.leads;}
  catch(e){if(gen!==generation||location.hash!==route)return;host.innerHTML='<p role="alert">'+esc(e.message)+'</p><button class="btn" id="cad-retry">Tentar novamente</button>';host.querySelector('#cad-retry').onclick=render;return;}
  if(gen!==generation||location.hash!==route)return;
  host.innerHTML=`<section class="cadastro-clientes"><div class="cad-tools"><p>Nome, contato e responsável de cada cadastro. Abra a ficha para consultar propostas e envios.</p><a class="btn-lime" href="#/admin/clientes?visao=atendimentos&novo=1">+ Cadastrar cliente</a></div><nav class="cad-views" aria-label="Visão dos clientes"><a href="#/admin/clientes" aria-current="page">Cadastros</a><a href="#/admin/clientes?visao=atendimentos">Atendimentos</a><a href="#/admin/painel?visao=compradores">Compradores</a></nav><div class="cad-filters"><label>Buscar cliente<input id="cad-q" placeholder="Nome, telefone ou unidade" value="${esc(filter.q)}"></label><label>Etapa<select id="cad-etapa"><option value="">Todas as etapas</option>${Object.entries(stages).map(([key,label])=>`<option value="${key}" ${filter.etapa===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Responsável<select id="cad-corretor"><option value="">Todos os corretores</option>${[...new Set(leads.map(l=>[l.corretorNome,l.empresaNome].filter(Boolean).join(' · ')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(c=>`<option ${filter.corretor===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><button class="btn-mini" id="cad-clear">Limpar filtros</button></div><p id="cad-count" class="nota" role="status"></p><div id="cad-list"></div><p class="nota">Contagem de registros do CRM, não de pessoas únicas. “Fechado no CRM” não substitui a situação de venda da unidade.</p></section>`;
  const paint=()=>{
   const rows=leads.filter(l=>(!filter.etapa||l.estagio===filter.etapa)&&(!filter.corretor||[l.corretorNome,l.empresaNome].filter(Boolean).join(' · ')===filter.corretor)&&(!filter.q||norm([l.cliente,l.clienteTel,l.unidade].join(' ')).includes(norm(filter.q).trim()))).sort((a,b)=>(a.cliente||'').localeCompare(b.cliente||'','pt-BR'));
   host.querySelector('#cad-count').textContent=rows.length+' de '+leads.length+' cadastro(s) · ordem alfabética';
   host.querySelector('#cad-list').innerHTML=rows.length?rows.map(l=>`<article class="cad-row" data-stage="${esc(l.estagio||'sem-etapa')}"><div><a class="cad-name" href="#/cliente/${encodeURIComponent(l.id)}?voltar=${encodeURIComponent(route)}">${esc(l.cliente||'Nome não informado')}</a><small>${esc(l.clienteTel||'Telefone não informado')}</small></div><div><span>Responsável</span><strong>${esc(l.corretorNome||'Não informado')}</strong><small>${esc(l.empresaNome||'')}</small></div><div><span class="cad-stage cad-stage-${esc(l.estagio||'sem-etapa')}">${esc(stages[l.estagio]||'Etapa não informada')}</span><strong>${l.unidade?'Unidade '+esc(l.unidade):'Unidade não definida'}</strong><small>${l.proximoContato?'Retorno: '+esc(l.proximoContato.split('-').reverse().join('/')):'Sem retorno agendado'}</small></div><div class="cad-actions"><a class="btn-mini" href="#/cliente/${encodeURIComponent(l.id)}?voltar=${encodeURIComponent(route)}">Abrir ficha</a><a class="btn-mini" href="#/admin/clientes?cliente=${encodeURIComponent(l.id)}">Ver atendimento</a></div></article>`).join(''):'<p class="vazio">Nenhum cadastro corresponde aos filtros.</p>';
  };
  const syncStage=()=>{params.delete('etapa');if(filter.etapa)params.set('etapa',filter.etapa);route='#/admin/clientes'+(params.size?'?'+params.toString():'');history.replaceState(null,'',route);};
  for(const key of ['q','etapa','corretor'])host.querySelector('#cad-'+key).addEventListener(key==='q'?'input':'change',e=>{filter[key]=e.target.value;if(key==='etapa')syncStage();paint();});
  host.querySelector('#cad-clear').onclick=()=>{filter={q:'',etapa:'',corretor:''};for(const k in filter)host.querySelector('#cad-'+k).value='';syncStage();paint();};paint();
 }
 window.DiamondClientesPainel={render};
})();
