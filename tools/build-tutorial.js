// Builds tutorial.html from TUTORIAL.md + tools/tutorial.template.html.
// Code blocks are pre-highlighted with hum's own highlighter, and the page's
// play buttons run hum-core + hum-engine inlined from index.html — so the
// tutorial can't drift from the app.
//
// Run after editing TUTORIAL.md or the template:   npm run sync
// --check (CI / pre-commit) verifies without writing.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadBlocks, scriptBlock } from './hum-blocks.js';

const MD_PATH = new URL('../TUTORIAL.md', import.meta.url);
const TEMPLATE_PATH = new URL('./tutorial.template.html', import.meta.url);
const OUT_PATH = new URL('../tutorial.html', import.meta.url);

const { highlightHum } = loadBlocks(['hum-core']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// `code`, **bold**, [text](url). Code spans are cut out first so their
// contents (`c4*4`, `**`) are never read as markup.
function inline(text) {
  return text.split(/(`[^`]+`)/).map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return `<code>${esc(part.slice(1, -1))}</code>`;
    }
    return esc(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }).join('');
}

function codeBlock(src) {
  return [
    '<div class="code-wrap">',
    '  <div class="code-toolbar"><span class="status"></span><button class="play-btn">play</button></div>',
    `  <pre class="code">${highlightHum(src)}</pre>`,
    '</div>',
  ].join('\n');
}

// The markdown subset TUTORIAL.md uses: `## ` sections, ``` fences,
// `- ` lists (continuations indented), paragraphs. Everything before the
// first `## ` is the intro, which the template's header replaces.
function render(md) {
  const lines = md.split('\n');
  const toc = [];
  const out = [];
  let i = lines.findIndex((l) => l.startsWith('## '));
  let open = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (open) out.push('</section>', '');
      const title = line.slice(3).trim();
      const num = title.match(/^(\d+)\.\s+(.*)$/);
      const id = num ? `s${num[1]}` : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<section id="${id}">`);
      if (num) {
        out.push(`<h2><span class="num">${num[1]}</span>${inline(num[2])}</h2>`);
        toc.push(`    <li><a href="#${id}">${num[1]}. ${inline(num[2])}</a></li>`);
      } else {
        out.push(`<h2>${inline(title)}</h2>`);
      }
      open = true;
      i++;
    } else if (line.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++; // closing fence
      out.push(codeBlock(body.join('\n')));
    } else if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith('- ') || /^ {2}\S/.test(lines[i]))) {
        if (lines[i].startsWith('- ')) items.push([lines[i].slice(2)]);
        else items.at(-1).push(lines[i].trim());
        i++;
      }
      out.push('<ul>', ...items.map((it) => `<li>${inline(it.join('\n'))}</li>`), '</ul>');
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(## |```|- )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join('\n'))}</p>`);
    }
  }
  if (open) out.push('</section>');
  return { toc: toc.join('\n'), content: out.join('\n') };
}

const { toc, content } = render(readFileSync(MD_PATH, 'utf8'));
const html = readFileSync(TEMPLATE_PATH, 'utf8')
  .replace('{{generated}}', '<!-- Generated from TUTORIAL.md by tools/build-tutorial.js. Do not edit by hand. -->')
  .replace('{{toc}}', () => toc)
  .replace('{{content}}', () => content)
  .replace(/\{\{script:([\w-]+)\}\}/g, (_, id) => scriptBlock(id));

const current = (() => {
  try { return readFileSync(OUT_PATH, 'utf8'); } catch { return ''; }
})();

if (process.argv.includes('--check')) {
  if (html !== current) {
    console.error('tutorial.html is stale — run `npm run sync`');
    process.exit(1);
  }
  console.log('tutorial: in sync');
} else {
  writeFileSync(OUT_PATH, html);
  console.log('tutorial: built tutorial.html');
}
