/**
 * Runs src/core/dates.ts in a fresh Node process whose TZ is set by the parent test
 * (datesTz.test.ts), and prints what the functions return for the given instants. The parent
 * compares with wall-clock values computed by Intl for that explicit time zone, so the result
 * doesn't depend on the machine's zone or on jest's globalSetup (QA retest 217 #8).
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const file = path.join(__dirname, '..', '..', 'dates.ts');
const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const m = new Module(file);
m.filename = file;
m._compile(out.outputText, file);
const d = m.exports;

const instants = JSON.parse(process.argv[2]);
const rows = instants.map((now) => ({
  now,
  offset: new Date(now).getTimezoneOffset(),
  today: d.localDateKey(d.localDayStart(0, now)),
  tomorrow: d.localDateKey(d.localDayStart(1, now)),
  todayStart: d.localDayStart(0, now),
  at18Tomorrow: d.localAt(1, 18, now),
  at9In3: d.localAt(3, 9, now),
  offsetOf18Tomorrow: d.localDayOffset(d.localAt(1, 18, now), now),
  offsetOf9In3: d.localDayOffset(d.localAt(3, 9, now), now),
  firstHour: d.firstFutureHour([0, 6, 7, 18, 20, 23], 0, now),
  tourToday: d.tournamentDates(0, 1, now),
  tourWeek: d.tournamentDates(7, 3, now),
  tourWeekEndOffset: d.localDayOffset(d.tournamentDates(7, 3, now).endDate, now),
}));
process.stdout.write(JSON.stringify({ tz: process.env.TZ, resolved: Intl.DateTimeFormat().resolvedOptions().timeZone, rows }));
