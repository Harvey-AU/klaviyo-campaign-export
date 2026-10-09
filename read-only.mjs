#!/usr/bin/env node
// Read-only Klaviyo API client. Only ever issues GET requests.
// Key: KLAVIYO_PRIVATE_API_KEY, usually from brands/<brand>.env via --brand.
// CLI:  node read-only.mjs --brand <brand> <path> [param=value ...] [--all]
//   e.g. node read-only.mjs --brand bobby metrics --all
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'https://a.klaviyo.com/api/';
const REVISION = '2024-10-15';

export function loadBrand(brand) {
  if (!brand) return;
  const file = new URL(`./brands/${brand}.env`, import.meta.url);
  if (!existsSync(file)) throw new Error(`no brands/${brand}.env; copy .env.example to create it`);
  process.loadEnvFile(file);
}

function apiKey() {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error('KLAVIYO_PRIVATE_API_KEY is not set; pass --brand <brand> or export it');
  return key;
}

export async function klaviyoGet(pathOrUrl, params = {}) {
  const url = new URL(pathOrUrl, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (;;) {
    const r = await fetch(url, {
      headers: { authorization: `Klaviyo-API-Key ${apiKey()}`, revision: REVISION, accept: 'application/vnd.api+json' },
    });
    if (r.status === 429) {
      await sleep(Number(r.headers.get('retry-after') ?? 1) * 1000);
      continue;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(`Klaviyo ${r.status} ${url.pathname}: ${JSON.stringify(j.errors ?? j)}`);
    return j;
  }
}

export async function klaviyoGetAll(path, params) {
  const data = [];
  const included = [];
  let page = await klaviyoGet(path, params);
  for (;;) {
    data.push(...page.data);
    included.push(...(page.included ?? []));
    if (!page.links?.next) return { data, included };
    page = await klaviyoGet(page.links.next);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let args = process.argv.slice(2);
  if (args[0] === '--brand') {
    loadBrand(args[1]);
    args = args.slice(2);
  }
  const [path, ...rest] = args;
  if (!path) {
    console.error('usage: node read-only.mjs [--brand <brand>] <path> [param=value ...] [--all]');
    process.exit(64);
  }
  const params = Object.fromEntries(
    rest.filter((a) => a !== '--all').map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
  );
  const out = rest.includes('--all') ? await klaviyoGetAll(path, params) : await klaviyoGet(path, params);
  console.log(JSON.stringify(out, null, 2));
}
