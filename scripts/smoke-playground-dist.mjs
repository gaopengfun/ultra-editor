import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../playground/dist');
const assets = resolve(dist, 'assets');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const files = await readdir(assets);
const javascriptFiles = files.filter((file) => file.endsWith('.js'));

for (const file of javascriptFiles) {
  const code = await readFile(resolve(assets, file), 'utf8');
  assert.ok(
    !code.includes('__ULTRA_EDITOR_VERSION__'),
    `${file} contains an unreplaced build constant`
  );
}

const entryPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
assert.ok(entryPath, 'Playground entry script is missing');

const initialPreloads = Array.from(
  html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  (match) => match[1]
);
assert.ok(
  initialPreloads.some((file) => /\/vue-[^/]+\.js$/.test(file)),
  'Vue is not preloaded'
);
assert.ok(
  initialPreloads.every((file) => !/(?:tiptap|prosemirror|UeCropper|src)-/.test(file)),
  'Heavy editor chunks must not be preloaded by index.html'
);

const entryCode = await readFile(resolve(assets, basename(entryPath)), 'utf8');
const editorFile = entryCode.match(/import\([`"']\.\/([^`"']+\.js)/)?.[1];
assert.ok(editorFile, 'Playground editor dynamic import is missing');

for (const group of ['vue-', 'tiptap-', 'prosemirror-']) {
  const chunk = files.find((file) => file.startsWith(group) && file.endsWith('.js'));
  assert.ok(chunk, `Playground ${group.slice(0, -1)} chunk is missing`);
  assert.ok(entryCode.includes(chunk), `${chunk} is not attached to the editor async boundary`);
}

const editorCode = await readFile(resolve(assets, editorFile), 'utf8');
const cropperFile = editorCode.match(/import\([`"']\.\/(UeCropper-[^`"']+\.js)/)?.[1];
assert.ok(cropperFile, 'Playground cropper dynamic import is missing');
assert.ok(files.includes(cropperFile), `${cropperFile} was referenced but not emitted`);

console.log('Playground initial, editor and cropper loading boundaries are intact.');
