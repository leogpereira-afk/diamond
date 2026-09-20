/** @OnlyCurrentDoc */
const DIAMOND_SHEET = SpreadsheetApp.getActiveSpreadsheet().getId();
const DIAMOND_API = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1/dmd-sheets';
function verificarConexao() {
  const token = ScriptApp.getIdentityToken();
  if (!token) throw Error('Autorize a identificação Google.');
  const claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1])).getDataAsString());
  console.log('Identificador público da integração: ' + claims.aud);
  console.log('Planilha: ' + planilhaDiamond_().getName());
  console.log('Verificação concluída. Nenhum dado foi alterado.');
}
function ativarSincronizacao() {
  sincronizarDiamond();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sincronizarDiamond')) {
    ScriptApp.newTrigger('sincronizarDiamond').timeBased().everyMinutes(1).create();
  }
  console.log('Sincronização Diamond ativada: a cada minuto.');
}
function planilhaDiamond_() {
  const s = SpreadsheetApp.getActiveSpreadsheet();
  if (!s || s.getId() !== DIAMOND_SHEET) throw Error('Este projeto deve estar vinculado à planilha Vagas Estacionamento.');
  return s;
}
function fonteDiamond_(s) {
  const aba=s.getSheetByName('Vagas de Garagem');
  if(!aba) throw Error('A aba Vagas de Garagem não foi encontrada.');
  return {spreadsheetId:DIAMOND_SHEET,vinculos:aba.getRange('B8:M90').getDisplayValues()};
}
function apiDiamond_(body) {
  const r = UrlFetchApp.fetch(DIAMOND_API, {method:'post',contentType:'application/json',
    headers:{Authorization:'Bearer '+ScriptApp.getIdentityToken()},payload:JSON.stringify(body),muteHttpExceptions:true});
  let d; try { d = JSON.parse(r.getContentText()); } catch (_) { throw Error('Resposta inválida da integração.'); }
  if (r.getResponseCode() !== 200 || !d.ok) throw Error(d.erro || 'Integração indisponível.');
  return d;
}
function sincronizarDiamond() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const s = planilhaDiamond_();
    const p = apiDiamond_({operacao:'trocar',fonte:fonteDiamond_(s)});
    if (p.pendente) {
      // Confira todas as células antes de escrever; aceite também operações já aplicadas.
      const patches = p.pendente.patches;
      const mudou = patches.some(x => {
        const atual = s.getSheetByName(x.aba).getRange(x.celula).getDisplayValue();
        return atual !== x.antes && atual !== x.depois;
      });
      if (mudou) {
        apiDiamond_({operacao:'abortar',id:p.pendente.id});
        throw Error('A planilha mudou durante a sincronização. Alterações suspensas para conferência no Diamond.');
      }
      for (const x of patches) {
        const c = s.getSheetByName(x.aba).getRange(x.celula);
        const atual = c.getDisplayValue();
        if (atual === x.depois) continue;
        if (atual !== x.antes) throw Error('Edição simultânea detectada. A operação será conferida na próxima execução.');
        // Strings literais, sem executar fórmulas fornecidas por usuários.
        const v = /^\d{2}\/\d{2}\/\d{4}$/.test(x.depois)
          ? new Date(Number(x.depois.slice(6)), Number(x.depois.slice(3,5))-1, Number(x.depois.slice(0,2)),12)
          : (/^[=+@-]/.test(x.depois) ? "'"+x.depois : x.depois);
        if (v instanceof Date) c.setNumberFormat('dd/MM/yyyy');
        c.setValue(v);
      }
      SpreadsheetApp.flush();
      apiDiamond_({operacao:'confirmar',id:p.pendente.id,fonte:fonteDiamond_(s)});
    }
    console.log('Conferência concluída. Alertas: '+(p.alertas || 0));
  } finally { lock.releaseLock(); }
}
