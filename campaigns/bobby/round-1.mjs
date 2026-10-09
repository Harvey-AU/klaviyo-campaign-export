import { campaignResponses, defineJob, duplicatesChecklist, gsheet } from '../../lib/index.mjs';

export default defineJob({
  source: campaignResponses({ campaign: 'round-1-new-can-colour' }),
  options: ['Green', 'Maroon', 'Teal'],
  excludeDomains: ['drinkbobby.com', 'teamharvey.co'],
  top: 50,
  outputs: [
    gsheet({ sheet: process.env.ROUND_1_SHEET }),
    duplicatesChecklist(),
  ],
});
