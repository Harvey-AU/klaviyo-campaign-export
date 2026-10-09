// A source is (ctx) => Promise<Entry[]>, one Entry per submission.
import { klaviyoGetAll } from './klaviyo.mjs';

/**
 * @typedef {{at: string, profileId: string, email: string, firstName: string, lastName: string, phone: string,
 *   answer: string, device: string, utmSource: string, utmMedium: string, props: object,
 *   status?: string, note?: string, duplicateOf?: Entry, rank?: number}} Entry
 */

async function metricId(name) {
  const { data } = await klaviyoGetAll('metrics');
  const matches = data.filter((m) => m.attributes.name === name);
  if (matches.length !== 1) throw new Error(`expected one Klaviyo metric named "${name}", found ${matches.length}`);
  return matches[0].id;
}

export function campaignResponses({ campaign, metric = 'Bloom Campaign Response' }) {
  return async () => {
    const { data, included } = await klaviyoGetAll('events', {
      filter: `equals(metric_id,"${await metricId(metric)}")`,
      sort: 'datetime',
      include: 'profile',
      'fields[profile]': 'email,first_name,last_name,phone_number',
    });
    const profiles = new Map(included.filter((i) => i.type === 'profile').map((p) => [p.id, p.attributes]));
    return data
      .filter((e) => e.attributes.event_properties?.campaign === campaign)
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
          device: props.device ?? '',
          utmSource: props.utm_source ?? '',
          utmMedium: props.utm_medium ?? '',
          props,
        };
      });
  };
}
