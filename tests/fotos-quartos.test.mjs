import test from 'node:test';
import assert from 'node:assert/strict';
import { backend, store } from './helpers.mjs';

function setup() {
  const t = store(async () => { throw Error('A foto de teste deve estar no cache.'); });
  t.ctx.navigator.onLine = false;
  const fotos = new Map([
    ['planta-1', { id: 'planta-1', mime: 'image/jpeg', base64: 'um-quarto' }],
    ['planta-2', { id: 'planta-2', mime: 'image/jpeg', base64: 'dois-quartos' }],
  ]);
  t.mem.set('dv_cfg', JSON.stringify({ fotosTipo: { '03': 'planta-1' }, fotosTipo2Quartos: { '03': 'planta-2' } }));
  t.ctx.indexedDB = { open() {
    const req = {};
    queueMicrotask(() => {
      req.result = { transaction() {
        const tx = { objectStore: () => ({
          get(id) { const r = {}; queueMicrotask(() => { r.result = fotos.get(id); r.onsuccess(); }); return r; },
          put(foto) { fotos.set(foto.id, foto); queueMicrotask(() => tx.oncomplete()); },
        }) };
        return tx;
      } };
      req.onsuccess();
    });
    return req;
  } };
  const sources = [], angles = [];
  t.ctx.Image = class {
    constructor() { this.width = 100; this.height = 200; }
    set src(value) { this._src = value; sources.push(value); queueMicrotask(() => this.onload()); }
    get src() { return this._src; }
  };
  t.ctx.URL = { createObjectURL: () => 'blob:uploaded', revokeObjectURL() {} };
  t.ctx.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, drawImage() {}, translate() {}, rotate: angle => angles.push(angle) }),
    toDataURL: () => 'data:image/jpeg;base64,nova-imagem',
  }) };
  return { ...t, fotos, sources, angles, fila: () => JSON.parse(t.mem.get('dv_fila') || '[]') };
}

test('anexar planta de dois quartos preserva planta de um quarto e outros finais', async () => {
  const t = setup();
  const id = await t.s.anexarFotoTipo('03', {}, 2);
  assert.match(id, /^ft-03-2q-\d+$/);
  assert.equal(t.s.getCfg().fotosTipo['03'], 'planta-1');
  assert.equal(t.s.getCfg().fotosTipo2Quartos['03'], id);
  assert.equal(t.fotos.get(id).base64, 'nova-imagem');
  assert.deepEqual(t.fila().filter(x => x.action === 'delFoto').map(x => x.fileId), ['planta-2']);
  assert.equal(t.fila().find(x => x.action === 'setCfg').cfg.fotosTipo['03'], 'planta-1');
});

test('chamada legada de upload continua atualizando somente um quarto', async () => {
  const t = setup();
  const id = await t.s.anexarFotoTipo('03', {});
  assert.match(id, /^ft-03-\d+$/);
  assert.equal(t.s.getCfg().fotosTipo['03'], id);
  assert.equal(t.s.getCfg().fotosTipo2Quartos['03'], 'planta-2');
  assert.deepEqual(t.fila().filter(x => x.action === 'delFoto').map(x => x.fileId), ['planta-1']);
});

test('girar dois quartos carrega e substitui somente a imagem dessa opção', async () => {
  const t = setup();
  const id = await t.s.girarFotoTipo('03', 2);
  assert.match(id, /^ft-03-2q-\d+$/);
  assert.deepEqual(t.sources, ['data:image/jpeg;base64,dois-quartos']);
  assert.deepEqual(t.angles, [Math.PI / 2]);
  assert.equal(t.s.getCfg().fotosTipo['03'], 'planta-1');
  assert.equal(t.s.getCfg().fotosTipo2Quartos['03'], id);
  assert.deepEqual(t.fila().filter(x => x.action === 'delFoto').map(x => x.fileId), ['planta-2']);
});

test('girar sem imagem de dois quartos não utiliza a imagem de um quarto', async () => {
  const t = setup();
  t.mem.set('dv_cfg', JSON.stringify({ fotosTipo: { '03': 'planta-1' } }));
  assert.equal(await t.s.girarFotoTipo('03', 2), null);
  assert.deepEqual(t.sources, []);
  assert.deepEqual(t.fila(), []);
});

test('configuração da API persiste e devolve plantas das duas opções', async () => {
  const b = backend();
  b.table('cfg').set('cfg', { fotosTipo: { '03': 'planta-1' }, versao: 'Tabela de teste' });
  const saved = await b.request('setCfg', { cfg: { fotosTipo2Quartos: { '03': 'planta-2' } } }, 'admin');
  assert.equal(saved.status, 200);
  const result = await b.request('getCfg');
  assert.equal(result.cfg.fotosTipo['03'], 'planta-1');
  assert.equal(result.cfg.fotosTipo2Quartos['03'], 'planta-2');
  assert.equal(result.cfg.versao, 'Tabela de teste');
});
