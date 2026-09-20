import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {isImportModuleLoadError} from '../lib/inventory-import-errors.ts';

const cwd = new URL('..', import.meta.url);
function run(script) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd, encoding:'utf8', timeout:20000});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('the configured PDF parser and worker work without native Promise.try/withResolvers', async () => {
  const source = await readFile(new URL('../lib/inventory-pdf-browser.ts', import.meta.url), 'utf8');
  const parser = source.match(/await import\('([^']+)'\)/)[1];
  const worker = source.match(/import workerUrl from '([^']+)\?url'/)[1];
  // Each worker has its own globals: parser polyfills cannot repair its environment.
  run(`
    import assert from 'node:assert/strict';
    Promise.try = undefined; Promise.withResolvers = undefined;
    await import(${JSON.stringify(worker)});
    assert.equal(typeof Promise.try, 'function');
    assert.equal(typeof Promise.withResolvers, 'function');
  `);
  const output = run(`
    import assert from 'node:assert/strict';
    // Text extraction does not use canvas; supply the browser's DOMMatrix name.
    globalThis.DOMMatrix = class DOMMatrix {};
    Promise.try = undefined; Promise.withResolvers = undefined;
    const pdf = await import(${JSON.stringify(parser)});
    pdf.GlobalWorkerOptions.workerSrc = import.meta.resolve(${JSON.stringify(worker)});
    const stream = 'BT /F1 12 Tf 20 50 Td (Inventory 12 kg) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream'
    ];
    let text = '%PDF-1.4\\n'; const offsets = [0];
    for (let i=0;i<objects.length;i++) { offsets.push(text.length); text += (i+1)+' 0 obj\\n'+objects[i]+'\\nendobj\\n'; }
    const xref = text.length;
    text += 'xref\\n0 6\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('');
    text += 'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';
    const data = new TextEncoder().encode(text);
    const doc = await pdf.getDocument({data,isEvalSupported:false,useSystemFonts:true,disableFontFace:true}).promise;
    try {
      assert.equal(doc.numPages,1);
      const content = await (await doc.getPage(1)).getTextContent();
      assert.equal(content.items.filter(x=>'str' in x).map(x=>x.str).join(''), 'Inventory 12 kg');
      console.log('PDF_TEXT_OK');
    } finally { await doc.destroy(); }
  `);
  assert.match(output, /PDF_TEXT_OK/);
});

test('module-load recovery does not misclassify quota, network or invalid-PDF failures', () => {
  for (const message of ['Importing a module script failed.', 'Failed to fetch dynamically imported module: /assets/pdf-old.js', 'Setting up fake worker failed: failed import']) {
    assert.equal(isImportModuleLoadError(new Error(message)), true);
  }
  for (const message of ['OCR_HTTP_429', 'RESOURCE_EXHAUSTED', 'Invalid PDF structure.', 'Failed to fetch', 'Password required']) {
    assert.equal(isImportModuleLoadError(new Error(message)), false);
  }
});
