import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicFile = name => new URL('../' + name, import.meta.url);
const version = '?v=felicidade-20261104';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
  test(`${name} é PNG RGB opaco de ${size} pixels`, async () => {
    const data = await readFile(publicFile(name));
    assert.ok(data.length > 100);
    assert.ok(data.subarray(0, 8).equals(signature));
    assert.equal(data.toString('ascii', 12, 16), 'IHDR');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
    assert.equal(data[25], 2, 'Cor RGB, sem transparência nas bordas.');
  });
}

test('manifesto preserva identidade e usa os ícones aprovados com versão', async () => {
  const manifest = JSON.parse(await readFile(publicFile('manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Chama da Felicidade');
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.deepEqual(manifest.icons.map(icon => [icon.src, icon.sizes, icon.purpose]), [
    ['icon-192.png' + version, '192x192', 'any'],
    ['icon-512.png' + version, '512x512', 'any'],
  ]);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, 'https://example.test/chama-da-felicidade/');
    assert.equal(url.pathname, '/chama-da-felicidade/' + icon.src.split('?')[0]);
    assert.equal(icon.type, 'image/png');
  }
});

test('página aponta para favicon, Apple touch icon e manifesto versionados', async () => {
  const html = await readFile(publicFile('index.html'), 'utf8');
  assert.ok(html.includes('rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png' + version + '"'));
  assert.ok(html.includes('rel="icon" type="image/png" sizes="32x32" href="favicon-32.png' + version + '"'));
  assert.ok(html.includes('rel="manifest" href="manifest.json' + version + '"'));
});
