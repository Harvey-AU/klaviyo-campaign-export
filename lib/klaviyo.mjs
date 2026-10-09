// Read-only Klaviyo API client. Only ever issues GET requests.
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'https://a.klaviyo.com/api/';
const REVISION = '2024-10-15';

function apiKey() {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error('KLAVIYO_PRIVATE_API_KEY is not set; add it to brands/<brand>.env');
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
