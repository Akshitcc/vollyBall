/** Every phone box in the app is the shared PhoneInput (QA G4 / B1: login, team page, both New match sides). */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

it('the 4 phone boxes use PhoneInput (match/new renders TeamBuilder for side A and side B)', () => {
  expect(read('app/login.tsx')).toMatch(/<PhoneInput[\s\S]*?testID="phone-input"/);
  expect(read('app/team/[id].tsx')).toMatch(/<PhoneInput[\s\S]*?testID="team-add-phone"/);
  expect(read('components/TeamBuilder.tsx')).toMatch(/<PhoneInput[\s\S]*?testID=\{`\$\{testID\}-phone`\}/);
  const nm = read('app/match/new.tsx');
  expect(nm).toMatch(/<TeamBuilder /);
  expect(nm).toMatch(/testID="side-a"/);
  expect(nm).toMatch(/testID="side-b"/);
});

it('no other text field takes phone numbers', () => {
  const offenders = walk(SRC)
    .filter((f) => /\.tsx$/.test(f) && !f.endsWith('PhoneInput.tsx'))
    .filter((f) => /keyboardType="phone-pad"|autoComplete="tel|normalizePhone\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f));
  expect(offenders).toEqual([]);
});
