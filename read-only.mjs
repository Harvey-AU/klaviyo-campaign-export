#!/usr/bin/env node
// Ad-hoc read-only Klaviyo queries for a brand.
//   node read-only.mjs <brand> <path> [param=value ...] [--all]
//   e.g. node read-only.mjs bobby metrics --all
import { loadBrand } from './lib/brand.mjs';
import { klaviyoGet, klaviyoGetAll } from './lib/klaviyo.mjs';

const [brand, path, ...rest] = process.argv.slice(2);
if (!brand || !path) {
  console.error('usage: node read-only.mjs <brand> <path> [param=value ...] [--all]');
  process.exit(64);
}
loadBrand(brand);
const params = Object.fromEntries(
  rest.filter((a) => a !== '--all').map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
);
const out = rest.includes('--all') ? await klaviyoGetAll(path, params) : await klaviyoGet(path, params);
console.log(JSON.stringify(out, null, 2));
