/* global STORE */
// Reajuste com conferência, confirmação online e histórico por versão.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moeda = n => Number(n || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:2});
  const percentual = n => Number(n || 0).toLocaleString('pt-BR', {maximumFractionDigits:4}) + '%';
  const hoje = () => {const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const dataBr = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso;
  const horario = iso => {const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');};
  const itensDe = p => Array.isArray(p.itens) ? p.itens : [];
  function comparativo(p) {
    const itens = itensDe(p);
    return `<div class="precos-comparativo"><table><caption>Comparativo dos preços de tabela, antes dos descontos individuais</caption><thead><tr><th>Unidade</th><th>Situação</th><th>Base anterior</th>${p.modo==='regularizar'?'<th>Exibido com reajuste antigo</th>':''}<th>Nova tabela</th><th>Resultado</th></tr></thead><tbody>${itens.map(i=>`<tr class="${i.corrigida?'precos-corrigida':i.alterada?'precos-alterada':''}"><th scope="row">${esc(i.unidade || i.id)}</th><td>${esc(i.status)}</td><td>${moeda(i.anterior)}</td>${p.modo==='regularizar'?`<td>${moeda(i.exibidoAntes)}</td>`:''}<td><b>${moeda(i.novo)}</b></td><td>${i.corrigida?'Retirado reajuste indevido':i.alterada?`+ ${moeda(i.novo-i.anterior)}`:'Preservado'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function resumo(p) {
    const itens = itensDe(p), elegiveis = itens.filter(i=>i.alterada), corrigidas = itens.filter(i=>i.corrigida);
    return `<div class="precos-resumo"><span><b>${elegiveis.length}</b> disponíveis reajustadas</span><span><b>${itens.length-elegiveis.length}</b> preços base preservados</span>${corrigidas.length?`<span><b>${corrigidas.length}</b> exibições corrigidas</span>`:''}</div>`;
  }
  function mount(el, {temEdicao = () => false, marcarEdicao = () => {}, salvo = () => {}} = {}) {
    const cfg = STORE.getCfg() || {}, legado = Number(cfg.reajuste || 0);
    el.innerHTML = `<div class="precos-painel">
      <header class="precos-cab"><div><span class="precos-kicker">Tabela de preços</span><h2>${esc(cfg.versao || 'v1')} <small>· ${esc(cfg.dataTabela || 'Data não informada')}</small></h2></div><button class="btn-mini" id="precos-historico" aria-expanded="false">Histórico e comparativo</button></header>
      ${legado ? `<div class="precos-legado"><div><b>Reajuste de ${percentual(legado*100)} aguardando regularização</b><p>O método antigo atingiu todas as unidades. A correção mantém esse aumento nas disponíveis, retira o efeito das vendidas e reservadas e registra uma nova versão.</p></div><button class="btn-lime" id="precos-regularizar">Revisar correção</button></div>` : `<form class="precos-form"><label>Reajuste nas disponíveis (%)<input id="precos-percentual" type="number" min="0.0001" max="1000" step="any" placeholder="Ex.: 4" required></label><label>Data da nova tabela<input id="precos-data" type="date" value="${hoje()}" required></label><button class="btn-lime" type="submit">Revisar reajuste</button><p>A versão será criada automaticamente. Vendidas e reservadas mantêm seus preços.</p></form>`}
      <p class="precos-erro" role="alert" hidden></p><div id="precos-historico-lista" hidden></div>
    </div>`;
    const erro = msg => {const x=el.querySelector('.precos-erro');x.textContent=msg;x.hidden=!msg;};
    const historico = el.querySelector('#precos-historico-lista');
    el.querySelector('#precos-historico').onclick = async event => {
      const btn = event.currentTarget;
      if(!historico.hidden){historico.hidden=true;btn.setAttribute('aria-expanded','false');return;}
      historico.hidden=false;btn.setAttribute('aria-expanded','true');btn.disabled=true;historico.innerHTML='<p role="status">Consultando versões salvas…</p>';
      try {
        const r = await STORE.api('precosHistorico');
        if(!el.isConnected)return;
        const lista=r.historico || [];
        historico.innerHTML=lista.length?lista.map(p=>`<details class="precos-versao"><summary><span><b>${esc(p.versaoAnterior)} → ${esc(p.versaoNova)}</b> · ${percentual(p.percentual)}</span><small>${esc(p.dataTabela)} · ${esc(horario(p.criadoEm || p.em))}</small></summary><p class="precos-origem">${p.modo==='regularizar'?'Regularização do reajuste antigo. Comparação reconstruída a partir dos preços base e do percentual que estava salvo.':'Reajuste aplicado somente às unidades disponíveis.'} ${p.por?`Registrado por ${esc(p.por)}.`:''}</p>${resumo(p)}${comparativo(p)}</details>`).join(''):'<p class="precos-origem">Ainda não há versões registradas. O próximo reajuste salvará o comparativo aqui.</p>';
      } catch(e){historico.innerHTML=`<p role="alert">${esc(e.message)}</p>`;}
      finally{btn.disabled=false;}
    };
    async function revisar(modo, btn) {
      erro('');
      if(temEdicao()){erro('Salve as edições de unidade antes de revisar o reajuste.');return;}
      if(STORE.filaGet().some(x=>['upsert','setCfg'].includes(x.action))){erro('Aguarde a sincronização das unidades e configurações.');return;}
      const dados={modo,percentual:modo==='regularizar'?legado*100:Number(el.querySelector('#precos-percentual').value),dataTabela:modo==='regularizar'?dataBr(hoje()):dataBr(el.querySelector('#precos-data').value)};
      btn.disabled=true;
      try {
        const r = await STORE.api('precosPrevia',dados);
        if(!el.isConnected)return;
        const p=r.previa || r;
        if(!p.token || !Array.isArray(p.itens))throw Error('Não foi possível carregar o comparativo. Tente novamente.');
        abrirPrevia(p,dados,btn);
      } catch(e){erro(e.message);}
      finally{btn.disabled=false;}
    }
    function abrirPrevia(p,dados,origem) {
      const dialog=document.createElement('dialog');dialog.className='precos-dialog';dialog.setAttribute('aria-labelledby','precos-dialog-titulo');
      const operacaoId=crypto.randomUUID();let enviando=false;
      dialog.innerHTML=`<header><div><span class="precos-kicker">Conferência antes de salvar</span><h2 id="precos-dialog-titulo">${esc(p.versaoAnterior)} → ${esc(p.versaoNova)}</h2><p>${esc(p.dataTabela)} · Reajuste de ${percentual(p.percentual)}</p></div><button class="btn-mini" data-fechar aria-label="Fechar conferência">✕</button></header><div class="precos-dialog-conteudo">${p.modo==='regularizar'?'<p class="precos-origem">Os 4% não serão aplicados novamente sobre o valor exibido. A nova versão consolida o percentual já salvo nas disponíveis. Os preços base das demais ficam preservados.</p>'.replace('4%',percentual(p.percentual)):'<p class="precos-origem">Confira os valores. Somente unidades disponíveis e com preço definido recebem o reajuste.</p>'}${resumo(p)}${comparativo(p)}</div><footer><p class="precos-dialog-erro" role="alert"></p><button class="btn-mini" data-fechar>Voltar</button><button class="btn-lime" data-confirmar>Confirmar e salvar ${esc(p.versaoNova)}</button></footer>`;
      const fechar=()=>{if(enviando)return;dialog.close();dialog.remove();origem.focus();};
      dialog.querySelectorAll('[data-fechar]').forEach(b=>b.onclick=fechar);
      dialog.addEventListener('cancel',e=>{e.preventDefault();fechar();});
      dialog.querySelector('[data-confirmar]').onclick=async event=>{
        const btn=event.currentTarget;enviando=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);btn.textContent='Salvando na nuvem…';
        dialog.querySelector('.precos-dialog-erro').textContent='';
        try{
          await STORE.aplicarTabelaPrecos({...dados,token:p.token,operacaoId});
          dialog.close();dialog.remove();salvo();
        }catch(e){
          dialog.querySelector('.precos-dialog-erro').textContent=e.status===409?`${e.message} Volte e confira uma nova prévia.`:e.message;
          dialog.querySelectorAll('button').forEach(b=>b.disabled=false);
          btn.disabled=e.status===409;btn.textContent='Tentar salvar novamente';
        }finally{enviando=false;}
      };
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-fechar]').focus();
    }
    const form=el.querySelector('form');
    if(form){form.addEventListener('input',marcarEdicao);form.onsubmit=e=>{e.preventDefault();revisar('reajustar',form.querySelector('button'));};}
    const regularizar=el.querySelector('#precos-regularizar');if(regularizar)regularizar.onclick=()=>revisar('regularizar',regularizar);
  }
  window.DiamondPrecos={mount};
})();
