// Fixed core order: sort -> internal -> invalid answer -> one per person -> job steps -> rank.
// Steps only run after dedupe, so a custom rule can never change who counts as a person's first answer.
import { localTime } from './time.mjs';

export const STATUS = { COUNTED: 'Counted', DUPLICATE: 'Duplicate', INTERNAL: 'Internal', INVALID: 'Invalid answer' };

/**
 * @typedef {import('./sources.mjs').Entry} Entry
 * @typedef {{brand: {name: string, samePerson: string[][]}, job: Job, log: (...a: any[]) => void}} Ctx
 * @typedef {{entries: Entry[], options: string[], top: number, timezone: string, snapshotAt: string}} Result
 * @typedef {{
 *   source: (ctx: Ctx) => Promise<Entry[]>,
 *   options: string[],
 *   excludeDomains?: string[],
 *   top?: number,
 *   timezone?: string,
 *   steps?: ((entries: Entry[], ctx: Ctx) => Entry[] | void)[],
 *   outputs?: ((result: Result, ctx: Ctx) => unknown)[],
 * }} Job
 */

/** @param {Job} job */
export function defineJob(job) {
  if (typeof job.source !== 'function') throw new Error('job.source is required');
  if (!job.options?.length) throw new Error('job.options must list the answer options');
  return { excludeDomains: [], top: 50, timezone: 'Australia/Sydney', steps: [], outputs: [], ...job };
}

export const canonicalEmail = (email) => email.trim().toLowerCase().replace(/\+[^@]*@/, '@');

function personKeys(samePerson) {
  return new Map(samePerson.flatMap((group) => group.map((email) => [canonicalEmail(email), canonicalEmail(group[0])])));
}

function classify(entries, job, brand) {
  const excluded = new Set(job.excludeDomains.map((d) => d.toLowerCase()));
  const options = new Set(job.options);
  const samePerson = personKeys(brand.samePerson);
  const firstByPerson = new Map();
  for (const e of entries) {
    const email = canonicalEmail(e.email);
    const domain = email.split('@')[1];
    const person = samePerson.get(email) ?? (email || e.profileId);
    const first = firstByPerson.get(person);
    if (excluded.has(domain)) {
      Object.assign(e, { status: STATUS.INTERNAL, note: `Excluded domain ${domain}` });
    } else if (!options.has(e.answer)) {
      Object.assign(e, { status: STATUS.INVALID, note: `"${e.answer}" is not one of ${job.options.join(', ')}` });
    } else if (first) {
      const as = first.email === e.email ? '' : ` as ${first.email}`;
      Object.assign(e, { status: STATUS.DUPLICATE, duplicateOf: first, note: `First answer ${first.answer} at ${localTime(first.at, job.timezone)}${as}` });
    } else {
      firstByPerson.set(person, e);
      Object.assign(e, { status: STATUS.COUNTED, note: '' });
    }
  }
}

function rank(entries, job) {
  for (const option of job.options) {
    entries.filter((e) => e.status === STATUS.COUNTED && e.answer === option).forEach((e, i) => (e.rank = i + 1));
  }
}

/** @returns {Promise<Result>} */
export async function runJob(job, brand, { dryRun = false, log = console.log } = {}) {
  const ctx = { brand, job, log };
  let entries = (await job.source(ctx)).sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!entries.length) throw new Error('the source returned no submissions');
  classify(entries, job, brand);
  for (const step of job.steps) entries = (await step(entries, ctx)) ?? entries;
  rank(entries, job);

  const result = { entries, options: job.options, top: job.top, timezone: job.timezone, snapshotAt: localTime(new Date().toISOString(), job.timezone) };
  const counts = Object.groupBy(entries, (e) => e.status);
  log(`${entries.length} submissions: ${Object.entries(counts).map(([s, list]) => `${list.length} ${s.toLowerCase()}`).join(', ')}`);
  for (const option of job.options) log(`  ${option}: ${entries.filter((e) => e.rank && e.answer === option).length} ranked`);
  if (!dryRun) for (const output of job.outputs) await output(result, ctx);
  return result;
}
