#!/usr/bin/env node
// Snapshot one storefront campaign's responses from Klaviyo into a Google Sheet.
// Writes a "Campaign" tab with every submission, plus one ranked tab per answer option.
// Sheets access goes through the `gsheet` CLI (~/.local/bin/gsheet).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { klaviyoGetAll, loadBrand } from './read-only.mjs';

const brandIndex = process.argv.indexOf('--brand');
if (brandIndex !== -1) loadBrand(process.argv[brandIndex + 1]);

const env = process.env;
const { values: opts } = parseArgs({
  options: {
    brand: { type: 'string' },
    campaign: { type: 'string', default: env.CAMPAIGN_EXPORT_CAMPAIGN },
    sheet: { type: 'string', default: env.CAMPAIGN_EXPORT_SHEET },
    metric: { type: 'string', default: env.CAMPAIGN_EXPORT_METRIC ?? 'Bloom Campaign Response' },
    top: { type: 'string', default: env.CAMPAIGN_EXPORT_TOP ?? '50' },
    'exclude-domains': { type: 'string', default: env.CAMPAIGN_EXPORT_EXCLUDE_DOMAINS ?? '' },
    timezone: { type: 'string', default: env.CAMPAIGN_EXPORT_TIMEZONE ?? 'Australia/Sydney' },
    'same-person': { type: 'string', default: env.CAMPAIGN_EXPORT_SAME_PERSON },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!opts.campaign || (!opts.sheet && !opts['dry-run'])) {
  console.error(
    'usage: node campaign-export.mjs [--brand <brand>] [--campaign <slug>] [--sheet <id|url>] [--metric <name>] [--top 50] [--exclude-domains a.com,b.com] [--timezone Australia/Sydney] [--same-person <file>] [--dry-run]',
  );
  process.exit(64);
}
const TOP = Number(opts.top);
const EXCLUDED = new Set(opts['exclude-domains'].split(',').map((d) => d.trim().toLowerCase()).filter(Boolean));

const canonicalEmail = (email) => email.trim().toLowerCase().replace(/\+[^@]*@/, '@');
const SAME_PERSON = new Map(
  (opts['same-person'] ? JSON.parse(readFileSync(new URL(opts['same-person'], import.meta.url), 'utf8')) : []).flatMap(
    (group) => group.map((email) => [canonicalEmail(email), canonicalEmail(group[0])]),
  ),
);

const timeParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: opts.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function localTime(iso) {
  const p = Object.fromEntries(timeParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function fetchSubmissions() {
  const { data: metrics } = await klaviyoGetAll('metrics');
  const matches = metrics.filter((m) => m.attributes.name === opts.metric);
  if (matches.length !== 1) throw new Error(`expected one metric named "${opts.metric}", found ${matches.length}`);

  const { data: events, included } = await klaviyoGetAll('events', {
    filter: `equals(metric_id,"${matches[0].id}")`,
    sort: 'datetime',
    include: 'profile',
    'fields[profile]': 'email,first_name,last_name,phone_number',
  });
  const profiles = new Map(included.filter((i) => i.type === 'profile').map((p) => [p.id, p.attributes]));

  return events
    .filter((e) => e.attributes.event_properties?.campaign === opts.campaign)
    .map((e) => {
      const props = e.attributes.event_properties;
      const profileId = e.relationships?.profile?.data?.id ?? '';
      const profile = profiles.get(profileId) ?? {};
      return {
        at: e.attributes.datetime,
        profileId,
        email: profile.email ?? '',
        firstName: profile.first_name ?? '',
        lastName: profile.last_name ?? '',
        phone: profile.phone_number ?? '',
        answer: [props.answer].flat().filter(Boolean).join(', '),
        options: props.question_options,
        device: props.device ?? '',
        utmSource: props.utm_source ?? '',
        utmMedium: props.utm_medium ?? '',
      };
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function classify(submissions) {
  const firstByPerson = new Map();
  for (const s of submissions) {
    const domain = s.email.split('@')[1]?.toLowerCase();
    const email = canonicalEmail(s.email);
    const person = SAME_PERSON.get(email) ?? (email || s.profileId);
    const first = firstByPerson.get(person);
    if (EXCLUDED.has(domain)) {
      Object.assign(s, { status: 'Internal', note: `Excluded domain ${domain}` });
    } else if (first) {
      Object.assign(s, { status: 'Duplicate', note: `First answer ${first.answer} at ${localTime(first.at)}${first.email === s.email ? '' : ` as ${first.email}`}` });
    } else {
      firstByPerson.set(person, s);
      Object.assign(s, { status: 'Counted', note: '' });
    }
  }
}

function buildTabs(submissions) {
  const options = submissions.findLast((s) => Array.isArray(s.options))?.options ?? [...new Set(submissions.map((s) => s.answer))];
  const timeHeader = `Submitted at (${opts.timezone})`;
  const tabs = [
    {
      title: 'Campaign',
      header: [timeHeader, 'Email', 'First name', 'Last name', 'Phone', 'Answer', 'Status', 'Note', 'Device', 'UTM source', 'UTM medium', 'Klaviyo profile ID'],
      rows: submissions.map((s) => [localTime(s.at), s.email, s.firstName, s.lastName, s.phone, s.answer, s.status, s.note, s.device, s.utmSource, s.utmMedium, s.profileId]),
      highlight: 0,
    },
  ];
  for (const option of options) {
    const counted = submissions.filter((s) => s.status === 'Counted' && s.answer === option);
    tabs.push({
      title: option,
      header: ['Rank', `Top ${TOP}`, timeHeader, 'Email', 'First name', 'Last name', 'Phone', 'Device', 'Klaviyo profile ID'],
      rows: counted.map((s, i) => [i + 1, i < TOP, localTime(s.at), s.email, s.firstName, s.lastName, s.phone, s.device, s.profileId]),
      highlight: Math.min(TOP, counted.length),
    });
  }
  return tabs;
}

const tmp = mkdtempSync(join(tmpdir(), 'campaign-export-'));
let tmpCount = 0;
function gsheet(...args) {
  return execFileSync('gsheet', args, { encoding: 'utf8' });
}
function gsheetJSON(cmd, range, payload, ...flags) {
  const file = join(tmp, `${tmpCount++}.json`);
  writeFileSync(file, JSON.stringify(payload));
  return cmd === 'fmt' ? gsheet('fmt', opts.sheet, file) : gsheet(cmd, opts.sheet, range, file, ...flags);
}
function sheetIds() {
  return new Map(gsheet('tabs', opts.sheet).trim().split('\n').filter(Boolean).map((l) => l.split('\t')).map(([id, title]) => [title, Number(id)]));
}

function ensureTabs(titles) {
  let ids = sheetIds();
  const requests = [];
  const missing = titles.filter((t) => !ids.has(t));
  if (missing.includes('Campaign') && ids.has('Sheet1')) {
    requests.push({ updateSheetProperties: { properties: { sheetId: ids.get('Sheet1'), title: 'Campaign' }, fields: 'title' } });
    missing.splice(missing.indexOf('Campaign'), 1);
  }
  for (const title of missing) requests.push({ addSheet: { properties: { title } } });
  if (requests.length) gsheetJSON('fmt', null, requests);
  ids = sheetIds();
  return ids;
}

function writeTab(sheetId, tab, stamp) {
  const width = tab.header.length;
  const height = tab.rows.length + 1;
  gsheetJSON('fmt', null, [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: Math.max(1000, height + 1), frozenRowCount: 1 } }, fields: 'gridProperties(rowCount,frozenRowCount)' } },
    { updateCells: { range: { sheetId }, fields: 'userEnteredValue,userEnteredFormat' } },
  ]);
  gsheetJSON('write', `'${tab.title}'!A1`, [tab.header, ...tab.rows]);
  gsheetJSON('write', `'${tab.title}'!${String.fromCharCode(65 + width + 1)}1`, [['Snapshot'], [stamp]]);
  const requests = [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, endRowIndex: height, startColumnIndex: 0, endColumnIndex: width } } } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: width + 2 } } },
  ];
  if (tab.highlight) {
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: tab.highlight + 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.94, blue: 0.83 } } }, fields: 'userEnteredFormat.backgroundColor' } });
  }
  gsheetJSON('fmt', null, requests);
}

const submissions = await fetchSubmissions();
if (!submissions.length) throw new Error(`no "${opts.metric}" events with campaign "${opts.campaign}"`);
classify(submissions);
const tabs = buildTabs(submissions);

const count = (status) => submissions.filter((s) => s.status === status).length;
console.log(`${submissions.length} submissions: ${count('Counted')} counted, ${count('Duplicate')} duplicate, ${count('Internal')} internal`);
for (const t of tabs) console.log(`  ${t.title}: ${t.rows.length} rows`);
if (opts['dry-run']) process.exit(0);

const stamp = localTime(new Date().toISOString());
const ids = ensureTabs(tabs.map((t) => t.title));
for (const tab of tabs) writeTab(ids.get(tab.title), tab, stamp);
console.log(`wrote snapshot ${stamp} to ${opts.sheet}`);
