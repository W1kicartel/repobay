// Il README dei progetti diventa HTML sicuro: l'HTML grezzo resta testo, i link solo http, https, mailto o ancore, le immagini
// solo https, e i percorsi relativi puntano al repository su GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownSicuro } from '../server/markdown.js';

const md = (testo, o = { repo: 'esempio/progetto' }) => markdownSicuro(testo, o);

test('titoli, enfasi, codice ed elenchi', () => {
  assert.match(md('# Titolo'), /<h1[^>]*>Titolo<\/h1>/);
  assert.match(md('**forte** e *corsivo*'), /<strong>forte<\/strong> e <em>corsivo<\/em>/);
  assert.match(md('```\nnpm test\n```'), /<pre><code[^>]*>npm test\n?<\/code><\/pre>/);
  assert.match(md('- uno\n- due'), /<ul>\s*<li>uno<\/li>\s*<li>due<\/li>\s*<\/ul>/);
});

test('l\'HTML grezzo diventa testo: niente script, niente attributi on*', () => {
  for (const x of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<iframe src="https://example.com"></iframe>']) {
    const h = md(x);
    assert.doesNotMatch(h, /<(script|img|a|iframe)\b/i, h);
  }
});

test('link e immagini: solo protocolli sicuri; i relativi vanno al repository', () => {
  assert.doesNotMatch(md('[x](javascript:alert(1))'), /href=/);
  assert.doesNotMatch(md('[x](data:text/html,<script>alert(1)</script>)'), /href=/);
  assert.doesNotMatch(md('![x](http://example.com/a.png)'), /<img/);
  assert.match(md('![x](https://example.com/a.png)'), /<img[^>]+src="https:\/\/example\.com\/a\.png"/);
  assert.match(md('[guida](docs/GUIDA.md)'), /href="https:\/\/github\.com\/esempio\/progetto\/blob\/HEAD\/docs\/GUIDA\.md"/);
  assert.match(md('[sito](https://example.com)'), /rel="nofollow ugc noopener noreferrer"/);
});

test('un README patologico resta veloce (niente regex che esplodono)', () => {
  const t = Date.now();
  md('*'.repeat(50_000) + '['.repeat(20_000) + '`'.repeat(20_000) + '\n'.repeat(5_000) + '> '.repeat(10_000));
  assert.ok(Date.now() - t < 3000, `ci ha messo ${Date.now() - t} ms`);
});
