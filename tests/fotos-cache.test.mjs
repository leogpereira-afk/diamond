import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from './helpers.mjs';
const foto = { mime: 'image/jpeg', base64: '/9j/AA==' };
function setup({ local = null, writeFails = false, openFails = false } = {}) {
  let calls = 0;
  const t = store(async () => { calls++; return { ok: true, json: async () => foto }; });
  t.ctx.indexedDB = { open() {
    if (openFails) throw Error('IndexedDB bloqueado');
    const req = {};
    queueMicrotask(() => { req.result = { transaction(name, mode) {
      const tx = { objectStore: () => ({
        get() { const r = {}; queueMicrotask(() => { r.result = local; r.onsuccess(); }); return r; },
        put() { queueMicrotask(() => writeFails ? tx.onerror() : tx.oncomplete()); },
      }), error: Error('quota excedida') }; return tx;
    } }; req.onsuccess(); }); return req;
  } };
  return { ...t, calls: () => calls };
}
test('cache bloqueado não impede baixar a planta', async () => {
  const t = setup({ openFails: true });
  assert.equal((await t.s.obterFoto('planta')).base64, foto.base64);
  assert.equal(t.calls(), 1);
});
test('quota de cache não descarta a imagem já baixada', async () => {
  const t = setup({ writeFails: true });
  assert.equal((await t.s.obterFoto('planta')).base64, foto.base64);
});
test('imagem local válida continua disponível sem consultar a rede', async () => {
  const t = setup({ local: foto });
  assert.equal((await t.s.obterFoto('planta')).base64, foto.base64);
  assert.equal(t.calls(), 0);
});
test('forçar atualização substitui cache corrompido', async () => {
  const t = setup({ local: { ...foto, base64: 'corrompida' } });
  assert.equal((await t.s.obterFoto('planta', { atualizar: true })).base64, foto.base64);
  assert.equal(t.calls(), 1);
});
