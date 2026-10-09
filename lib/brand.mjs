import { existsSync, readFileSync } from 'node:fs';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function brandFile(brand, suffix) {
  if (!NAME.test(brand ?? '')) throw new Error(`invalid brand name "${brand}"`);
  return new URL(`../brands/${brand}${suffix}`, import.meta.url);
}

export function loadBrand(brand) {
  const env = brandFile(brand, '.env');
  if (!existsSync(env)) throw new Error(`no brands/${brand}.env; copy .env.example to create it`);
  process.loadEnvFile(env);
  const samePerson = brandFile(brand, '.same-person.json');
  return {
    name: brand,
    samePerson: existsSync(samePerson) ? JSON.parse(readFileSync(samePerson, 'utf8')) : [],
  };
}
