/** 1.4.27: the web page's first paint uses the splash colours (no native splash on the web: no white flash). */
import fs from 'node:fs';
import path from 'node:path';

it('public/index.html starts on the Day / Night splash background of app.config.ts', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../../public/index.html'), 'utf8');
  const cfg = fs.readFileSync(path.resolve(__dirname, '../../../app.config.ts'), 'utf8');
  expect(cfg).toContain("backgroundColor: '#FFFAF3'");
  expect(cfg).toContain("backgroundColor: '#1E2A44'");
  expect(html).toMatch(/body \{\s*background-color: #FFFAF3;/);
  expect(html).toMatch(/prefers-color-scheme: dark\) \{\s*html,\s*body \{\s*background-color: #1E2A44;/);
  // 1.5.9 (F158-7): #root now holds the boot logo until the first render replaces it
  expect(html).toMatch(/<div id="root"><div id="vl-boot" aria-hidden="true"><img src="\/boot-logo.png"/);
});
