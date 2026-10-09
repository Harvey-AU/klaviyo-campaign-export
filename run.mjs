#!/usr/bin/env node
// node run.mjs <brand> <campaign> [--dry-run]  ->  runs campaigns/<brand>/<campaign>.mjs
import { existsSync } from 'node:fs';
import { loadBrand } from './lib/brand.mjs';
import { runJob } from './lib/pipeline.mjs';

const args = process.argv.slice(2);
const [brandName, campaign] = args.filter((a) => !a.startsWith('--'));
if (!brandName || !campaign) {
  console.error('usage: node run.mjs <brand> <campaign> [--dry-run]');
  process.exit(64);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(campaign)) throw new Error(`invalid campaign name "${campaign}"`);

const brand = loadBrand(brandName);
const file = new URL(`./campaigns/${brandName}/${campaign}.mjs`, import.meta.url);
if (!existsSync(file)) throw new Error(`no campaigns/${brandName}/${campaign}.mjs`);
const { default: job } = await import(file);
await runJob(job, brand, { dryRun: args.includes('--dry-run') });
