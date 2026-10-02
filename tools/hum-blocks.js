// Reads the named <script id="..."> blocks out of index.html so Node code
// (tests, build-tutorial) runs the app's real code instead of a copy.
//
//   hum-core    pure — loads with no globals
//   hum-engine  Web Audio — needs AudioContext-ish globals to *run*, but
//               evaluating it has no side effects

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

export function scriptBlock(id) {
  const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!m) throw new Error(`<script id="${id}"> not found in index.html`);
  return m[1];
}

// Evaluate the blocks in one shared scope (like classic scripts in a page)
// and return their top-level bindings as live getters, so `let` state such
// as audioCtx reads its current value. `globals` are injected by name.
export function loadBlocks(ids, globals = {}) {
  const src = ids.map(scriptBlock).join('\n');
  const names = [...src.matchAll(/^(?:function|class|const|let)\s+(\w+)/gm)].map((m) => m[1]);
  const getters = names.map((n) => `get ${n}() { return ${n}; }`).join(',\n');
  const fn = new Function(...Object.keys(globals), `${src}\nreturn {\n${getters}\n};`);
  return fn(...Object.values(globals));
}
