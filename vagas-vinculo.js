/* Vinculação feita na mesma base da garagem, sem criar outra lista de vagas. */
(function () {
  'use strict';
  const V = globalThis.DomoVagas;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function abrir({unidadeId, onSaved = () => {}}) {
    if (!STORE.podeVerPainel() || document.querySelector('#vaga-vinculo')) return;
    const sessao=()=>JSON.stringify([STORE.getUser()?.usuario,STORE.getUser()?.senhaHash,STORE.getUser()?.papel]);
    const sessaoInicial=sessao(),vigente=()=>sessao()===sessaoInicial&&STORE.podeVerPainel();
    const focusBefore = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'vaga-vinculo'; dialog.className = 'cliente-editor vv-editor';
    dialog.setAttribute('aria-labelledby', 'vv-titulo');
    dialog.innerHTML = '<header class="cc-head"><h2 id="vv-titulo">Vincular vaga</h2><button type="button" class="cc-close" aria-label="Fechar vínculo">×</button></header><div class="cc-loading" role="status">Consultando vagas livres…</div>';
    document.body.append(dialog); dialog.showModal();
    let saving = false, base, u, livres = [];
    const close = () => { if (saving) return; dialog.close(); dialog.remove(); focusBefore?.focus(); };
    dialog.querySelector('.cc-close').onclick = close;
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });

    async function carregar(escolhida = '', aviso = '') {
      try {
        const r = await STORE.api('vagas', {operacao:'carregar', unidadeId});
        if (!dialog.isConnected) return;
        if(!vigente()){saving=false;close();return;}
        if (!r.ok || !r.estado || !r.unidade) throw Error('Não foi possível conferir o apartamento. Atualize a tela e tente novamente.');
        base = r; u = r.unidade; livres = V.livres(r.estado);
        const key = s => String(s || '').replace(/^(?:apto\.?|apartamento)\s*/i, '').trim().toUpperCase();
        const vinculadas = V.efetivas(r.estado).filter(v => key(v.apartamento) === key(u.unidade) || (v.alertas?.length && v.origem?.vinculos?.some(x => key(x.apartamento) === key(u.unidade))));
        const pendente = !!r.estado.sync?.pendente;
        const unidadePendente=Object.keys(r.estado.ajustesUnidades||{}).some(a=>key(a)===key(u.unidade));
        const bloqueio = vinculadas.length ? 'Este apartamento já tem vaga vinculada. Abra a garagem para conferir ou trocar o vínculo.' : unidadePendente ? 'A atualização deste apartamento aguarda confirmação na planilha. Aguarde antes de vincular uma vaga.' : pendente ? 'A planilha está confirmando uma atualização. Aguarde e consulte novamente.' : !livres.length ? 'Não há vagas livres para vincular neste momento.' : '';
        const cliente = u.clienteVinculadoNome || u.reserva?.cliente || u.compradorNome || u.comprador || u.clienteNome || u.cliente || '';
        dialog.innerHTML = `<header class="cc-head"><div><span>DIAMOND · GARAGEM</span><h2 id="vv-titulo">Vincular vaga · ${esc(u.unidade)}</h2></div><button type="button" class="cc-close" aria-label="Fechar vínculo">×</button></header><form id="vv-form"><div class="cc-body"><div class="vv-unit"><strong>Apartamento ${esc(u.unidade)}</strong><span>${esc(u.status || 'Situação não informada')}${cliente ? ' · ' + esc(cliente) : ''}</span></div><p class="cc-info">Escolha a vaga deste apartamento. O vínculo não altera seu preço, comprador ou situação de venda.</p>${bloqueio ? `<p class="vv-warning" role="status">${esc(bloqueio)}</p>${vinculadas.map(v => `<a class="v-vaga" href="#/admin/vagas?vaga=${encodeURIComponent(v.codigo)}">Abrir ${esc(v.codigo)}</a>`).join('')}` : `<label>Vaga livre<select id="vv-vaga" required><option value="">Selecione uma vaga</option>${V.PISOS.map(p => { const op = livres.filter(v => v.piso === p.id); return op.length ? `<optgroup label="${esc(p.nome)}">${op.map(v => `<option value="${v.codigo}" ${v.codigo === escolhida ? 'selected' : ''}>${v.codigo} · ${esc(p.nome)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label><div id="vv-escolha" class="vv-choice" role="status">${livres.length} vagas livres, sem apartamento ou cliente vinculado.</div>`}<p id="vv-error" role="alert" ${aviso ? '' : 'hidden'}>${esc(aviso)}</p><button type="button" id="vv-refresh" class="btn-mini">Atualizar vagas livres</button></div><footer class="cc-footer"><span id="vv-state">O vínculo será salvo com histórico e enviado à planilha.</span><button type="button" class="btn-mini" id="vv-cancel">Cancelar</button><button type="submit" class="btn-lime" id="vv-save" ${bloqueio ? 'disabled' : ''}>Vincular vaga</button></footer></form>`;
        const $ = s => dialog.querySelector(s), form = $('#vv-form'), select = $('#vv-vaga');
        $('.cc-close').onclick = close; $('#vv-cancel').onclick = close;
        dialog.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
        $('#vv-refresh').onclick = async () => { $('#vv-refresh').disabled = true; await carregar(select?.value || ''); };
        if (select) {
          const escolha = () => { const v = livres.find(v => v.codigo === select.value); $('#vv-escolha').textContent = v ? `${v.codigo} · ${V.PISOS[v.piso].nome} → Apartamento ${u.unidade}` : `${livres.length} vagas livres, sem apartamento ou cliente vinculado.`; };
          select.onchange = escolha; escolha(); select.focus();
        }
        form.onsubmit = async e => {
          e.preventDefault(); if (saving || bloqueio || !form.reportValidity()) return;
          const codigo = select.value;
          saving = true; form.querySelectorAll('button,select').forEach(el => el.disabled = true); $('.cc-close').disabled = true;
          $('#vv-state').textContent = 'Conferindo e salvando o vínculo…'; $('#vv-error').hidden = true;
          try {
            const atual=await STORE.api('vagas',{operacao:'carregar',unidadeId});
            if(!vigente()){saving=false;close();return;}
            const chave=s=>String(s||'').replace(/^(?:apto\.?|apartamento)\s*/i,'').trim().toUpperCase();
            const linha=estado=>JSON.stringify((estado.unidades||[]).filter(x=>chave(x.apartamento)===chave(u.unidade)).map(x=>Object.fromEntries(Object.entries(x).filter(([k])=>k&&k!=='contador de dias').sort(([a],[b])=>a.localeCompare(b)))));
            if(!atual.unidade||atual.unidade.atualizadoEm!==u.atualizadoEm||linha(atual.estado)!==linha(base.estado))throw Error('Os dados do apartamento mudaram.');
            if(atual.estado.sync?.pendente)throw Error('A planilha está confirmando uma atualização.');
            if(!V.livres(atual.estado).some(v=>v.codigo===codigo))throw Error('A vaga escolhida já não está livre.');
            const r = await STORE.api('vagas', {operacao:'vincularUnidade', unidadeId, codigo, revisao:atual.revisao, unidadeRevisao:u.atualizadoEm || ''});
            if(!vigente()){saving=false;close();return;}
            if (!r.ok) throw Error('O vínculo não foi confirmado. Confira antes de tentar novamente.');
            saving = false; close(); onSaved(r);
          } catch (err) {
            saving = false;if(!vigente()){close();return;}
            // Reconsultar nunca reenvia a gravação: a pessoa confere antes de salvar outra vez.
            await carregar(codigo, err.message + ' Sua escolha foi mantida se a vaga continua livre. Confira antes de salvar novamente.');
          }
        };
      } catch (err) {
        if (!dialog.isConnected) return;
        if(!vigente()){saving=false;close();return;}
        const loading = dialog.querySelector('.cc-loading');
        if (loading) { loading.textContent = err.message; const retry = document.createElement('button'); retry.className = 'btn-mini'; retry.textContent = 'Tentar novamente'; retry.onclick = () => carregar(escolhida, aviso); loading.append(document.createElement('br'), retry); }
        else { const error = dialog.querySelector('#vv-error'); error.hidden = false; error.textContent = err.message + ' Feche e abra novamente para conferir a gravação.'; dialog.querySelectorAll('button').forEach(el => el.disabled = false); dialog.querySelector('#vv-save').disabled = true; }
      }
    }
    await carregar();
  }
  window.DiamondVagaVinculo = {abrir};
})();
