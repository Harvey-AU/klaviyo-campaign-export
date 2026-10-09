// An output is (result, ctx) => unknown, run after the pipeline unless --dry-run.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUS } from './pipeline.mjs';
import { localTime } from './time.mjs';

const HEADER_FILL = { red: 0.93, green: 0.93, blue: 0.93 };
const TOP_FILL = { red: 0.85, green: 0.94, blue: 0.83 };

function sheetTabs({ entries, options, top, timezone }, campaignTab) {
  const time = `Submitted at (${timezone})`;
  const tabs = [{
    title: campaignTab,
    header: [time, 'Email', 'First name', 'Last name', 'Phone', 'Answer', 'Status', 'Note', 'Device', 'UTM source', 'UTM medium', 'Klaviyo profile ID'],
    rows: entries.map((e) => [localTime(e.at, timezone), e.email, e.firstName, e.lastName, e.phone, e.answer, e.status, e.note, e.device, e.utmSource, e.utmMedium, e.profileId]),
    highlight: 0,
  }];
  for (const option of options) {
    const ranked = entries.filter((e) => e.rank && e.answer === option).sort((a, b) => a.rank - b.rank);
    tabs.push({
      title: option,
      header: ['Rank', `Top ${top}`, time, 'Email', 'First name', 'Last name', 'Phone', 'Device', 'Klaviyo profile ID'],
      rows: ranked.map((e) => [e.rank, e.rank <= top, localTime(e.at, timezone), e.email, e.firstName, e.lastName, e.phone, e.device, e.profileId]),
      highlight: Math.min(top, ranked.length),
    });
  }
  return tabs;
}

function gsheetClient(sheet) {
  const tmp = mkdtempSync(join(tmpdir(), 'campaign-export-'));
  let n = 0;
  const run = (...args) => execFileSync('gsheet', args, { encoding: 'utf8' });
  const file = (payload) => {
    const path = join(tmp, `${n++}.json`);
    writeFileSync(path, JSON.stringify(payload));
    return path;
  };
  return {
    tabs: () => new Map(run('tabs', sheet).trim().split('\n').filter(Boolean).map((l) => l.split('\t')).map(([id, title]) => [title, Number(id)])),
    batch: (requests) => run('fmt', sheet, file(requests)),
    write: (range, values) => run('write', sheet, range, file(values)),
  };
}

function ensureTabs(client, titles, campaignTab) {
  const ids = client.tabs();
  const missing = titles.filter((t) => !ids.has(t));
  const requests = [];
  if (missing.includes(campaignTab) && ids.has('Sheet1')) {
    requests.push({ updateSheetProperties: { properties: { sheetId: ids.get('Sheet1'), title: campaignTab }, fields: 'title' } });
    missing.splice(missing.indexOf(campaignTab), 1);
  }
  for (const title of missing) requests.push({ addSheet: { properties: { title } } });
  if (requests.length) client.batch(requests);
  return client.tabs();
}

function writeTab(client, sheetId, tab, snapshotAt) {
  const width = tab.header.length;
  const height = tab.rows.length + 1;
  const columns = (endRowIndex, startRowIndex = 0) => ({ sheetId, startRowIndex, endRowIndex, startColumnIndex: 0, endColumnIndex: width });
  client.batch([
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: Math.max(1000, height + 1), frozenRowCount: 1 } }, fields: 'gridProperties(rowCount,frozenRowCount)' } },
    { updateCells: { range: { sheetId }, fields: 'userEnteredValue,userEnteredFormat' } },
  ]);
  client.write(`'${tab.title}'!A1`, [tab.header, ...tab.rows]);
  client.write(`'${tab.title}'!${String.fromCharCode(65 + width + 1)}1`, [['Snapshot'], [snapshotAt]]);
  const requests = [
    { repeatCell: { range: columns(1), cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_FILL } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    { setBasicFilter: { filter: { range: columns(height) } } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: width + 2 } } },
  ];
  if (tab.highlight) {
    requests.push({ repeatCell: { range: columns(tab.highlight + 1, 1), cell: { userEnteredFormat: { backgroundColor: TOP_FILL } }, fields: 'userEnteredFormat.backgroundColor' } });
  }
  client.batch(requests);
}

/** Campaign tab with every submission, plus one ranked tab per answer option. Clears and rewrites only those tabs. */
export function gsheet({ sheet, campaignTab = 'Campaign' }) {
  if (!sheet) throw new Error('gsheet output needs a sheet URL or ID');
  return (result, { log }) => {
    if (result.options.includes(campaignTab)) throw new Error(`answer option "${campaignTab}" clashes with the campaign tab name`);
    const client = gsheetClient(sheet);
    const tabs = sheetTabs(result, campaignTab);
    const ids = ensureTabs(client, tabs.map((t) => t.title), campaignTab);
    for (const tab of tabs) writeTab(client, ids.get(tab.title), tab, result.snapshotAt);
    log(`wrote snapshot ${result.snapshotAt} to ${sheet}`);
  };
}

/** Prints a Slack-ready checklist of people who answered again under a different email. Stays on stdout. */
export function duplicatesChecklist() {
  return ({ entries, timezone }, { log }) => {
    const later = Map.groupBy(entries.filter((e) => e.status === STATUS.DUPLICATE && e.duplicateOf.email !== e.email), (e) => e.duplicateOf);
    if (!later.size) return log('No same-person duplicates.');
    const name = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ') || e.email;
    log('Possible duplicates (counted once, first answer only):');
    for (const [first, dupes] of later) {
      log(`- [ ] ${name(first)} - ${first.answer} (${first.email}, ${localTime(first.at, timezone)}). Later: ${dupes.map((d) => `${d.answer} (${d.email})`).join(', ')}`);
    }
  };
}
