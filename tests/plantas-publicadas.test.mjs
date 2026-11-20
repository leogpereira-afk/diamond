import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { root, source, store } from './helpers.mjs';

test('as sete propostas de dois quartos carregam o PNG completo pelo final da unidade', async () => {
  const downloads = [];
  const { ctx, s } = store(async path => {
    assert.ok(path.startsWith('plantas/2-quartos/'));
    downloads.push(path);
    const bytes = await fs.readFile(new URL(path, root));
    return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  });
  vm.runInContext(source('proposta-domain.js'), ctx);
  ctx.FileReader = class {
    async readAsDataURL(blob) {
      this.result = 'data:image/png;base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
      this.onload();
    }
  };
  for (const final of ['01', '03', '04', '05', '06', '07', '08']) {
    const id = ctx.window.DiamondProposta.fotoPlanta({ unidade: '9' + final }, {}, 2);
    const foto = await s.obterFoto(id);
    assert.equal(foto.mime, 'image/png');
    assert.match(downloads.at(-1), new RegExp('tipo ' + final, 'i'));
    const original = await fs.readFile(new URL(downloads.at(-1), root));
    assert.deepEqual(Buffer.from(foto.base64, 'base64'), original);
  }
  assert.equal(new Set(downloads).size, 7);
});
