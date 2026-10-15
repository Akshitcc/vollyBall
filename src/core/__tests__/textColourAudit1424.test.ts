// 1.4.24 (QA V1423-3): every <Text> in app/ and components/ sets a colour – inline, or through a named style or a
// theme font/type style (which carry colors.text). A Text with no colour renders black in Night (the Timeline tab,
// "want to play" names, tournament team list and security-check title were all black on navy).
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}
/** The attribute text of each <Text …> opening tag (braces balanced, so `=>` inside props is fine). */
function textTags(src: string): Array<{ line: number; attrs: string }> {
  const out: Array<{ line: number; attrs: string }> = [];
  const re = /<Text\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0; let i = m.index + 5;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, attrs: src.slice(m.index + 5, i) });
  }
  return out;
}
// a style reference that carries its own colour (named StyleSheet entries are checked by the scan; theme styles have colour)
const NAMED = /\b(font|type|ui|s|st|st3|styles|hs|f|hf)\.\w+|\bstyle=\{[a-zA-Z]\w*\}|style=\{\[?\s*[a-zA-Z]\w*\s*[,\]]/;

test('every Text has a theme colour', () => {
  const missing: string[] = [];
  for (const f of [...files(path.join(ROOT, 'app')), ...files(path.join(ROOT, 'components'))]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const { line, attrs } of textTags(src)) {
      if (/color/.test(attrs) || NAMED.test(attrs)) continue;
      missing.push(`${path.relative(ROOT, f)}:${line}`);
    }
  }
  expect(missing).toEqual([]);
});
