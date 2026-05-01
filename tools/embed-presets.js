// Inlines the contents of demos/*.hum into index.html between the
// PRESETS:START / PRESETS:END markers as `<script type="text/hum">`
// blocks. The preset picker reads these blocks at load time, which
// lets it work over `file://` where fetch from the local filesystem
// is blocked by the browser.
//
// Run after editing any demo:   npm run preset:embed
// Or in --check mode (used in CI / pre-commit) to verify without writing:
//                                 npm run preset:embed -- --check

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const HTML_PATH = new URL('../index.html', import.meta.url);
const DEMOS_DIR = new URL('../demos/', import.meta.url);
const START = '<!-- PRESETS:START -->';
const END = '<!-- PRESETS:END -->';

const demos = readdirSync(DEMOS_DIR)
  .filter((f) => f.endsWith('.hum'))
  .sort();

const blocks = demos.map((file) => {
  const name = file.replace(/\.hum$/, '');
  const body = readFileSync(new URL(file, DEMOS_DIR), 'utf8');
  return `<script type="text/hum" data-preset="${name}">\n${body.trimEnd()}\n</script>`;
}).join('\n');

const html = readFileSync(HTML_PATH, 'utf8');
const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END);
if (startIdx < 0 || endIdx < 0) {
  console.error(`Markers ${START} / ${END} not found in index.html`);
  process.exit(1);
}

const before = html.slice(0, startIdx + START.length);
const after = html.slice(endIdx);
const replaced = `${before}\n${blocks}\n${after}`;

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  if (replaced !== html) {
    console.error('index.html preset section is stale — run `npm run preset:embed`');
    process.exit(1);
  }
  console.log(`presets: ${demos.length} blocks in sync`);
} else {
  writeFileSync(HTML_PATH, replaced);
  console.log(`presets: embedded ${demos.length} blocks (${demos.join(', ')})`);
}
