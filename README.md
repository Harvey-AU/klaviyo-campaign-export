# klaviyo-campaign-export

Snapshots a storefront campaign's responses from Klaviyo into outputs such as a Google Sheet, for picking winners.
Each campaign is a small job file; rules and outputs are plain functions.

## Setup

Requires Node 21.7+ and the `gsheet` CLI on `PATH`, logged in (`gsheet login`).

Per brand, in `brands/` (gitignored, because it holds API keys and customer emails):

- `brands/<brand>.env` - copy `.env.example`; holds `KLAVIYO_PRIVATE_API_KEY` (read-only key) and each campaign's sheet URL.
  Sheet URLs stay out of the repo because the sheets hold customer data.
- `brands/<brand>.same-person.json` - optional; people known to use more than one email, one group per person: `[["a@x.com", "a@y.com"]]`.

## Running a campaign

```sh
node run.mjs bobby round-1 --dry-run   # fetch and classify, print counts, skip outputs
node run.mjs bobby round-1
```

This runs `campaigns/bobby/round-1.mjs`:

```js
export default defineJob({
  source: campaignResponses({ campaign: 'round-1-new-can-colour' }),
  options: ['Green', 'Maroon', 'Teal'],
  excludeDomains: ['drinkbobby.com', 'teamharvey.co'],
  top: 50,
  outputs: [gsheet({ sheet: process.env.ROUND_1_SHEET }), duplicatesChecklist()],
});
```

A new campaign is a copy of an existing file with the slug, options and sheet variable changed, plus that variable in `brands/<brand>.env`.

## What every job does

The core runs in a fixed order, so job files cannot get it wrong:

1. Sort submissions by submit time.
2. `Internal` - email at an `excludeDomains` domain.
3. `Invalid answer` - answer not in `options`.
   Options come from the job, never from event data, so a forged event cannot create or clear sheet tabs.
4. `Duplicate` - not the person's first answer.
   People are matched by email, with `+` aliases merged and the brand's same-person groups applied.
   Everyone else is `Counted`.
5. The job's `steps`, in order.
6. Rank `Counted` entries per option by submit time.

Then each output runs, unless `--dry-run`.

## Extending

A step is `(entries, ctx) => entries | void`.
It runs after dedupe and before ranking, so it decides who is ranked without changing who counts as a person's first answer.
Mark entries with a new `status` instead of dropping them, so the Campaign tab shows why:

```js
const correctAnswer = (answer) => (entries) => {
  for (const e of entries) if (e.status === STATUS.COUNTED && e.answer !== answer) Object.assign(e, { status: 'Wrong answer', note: `Answer was ${answer}` });
};
// steps: [correctAnswer('Green')]
```

An output is `(result, ctx) => unknown`, where `result` is `{ entries, options, top, timezone, snapshotAt }`.
A source is `(ctx) => Promise<Entry[]>`; see `lib/sources.mjs` for the `Entry` shape.

Write one-off functions in the campaign file.
Move them into `lib/` and export them from `lib/index.mjs` once a second campaign needs them.

Outputs that send data off this machine should only include the fields they need.

## Built-ins (`lib/index.mjs`)

- `campaignResponses({ campaign, metric })` - `Bloom Campaign Response` events whose `campaign` property matches.
- `gsheet({ sheet, campaignTab })` - a `Campaign` tab with every submission, plus one ranked tab per option with the top N highlighted.
  It clears and rewrites only those tabs.
- `duplicatesChecklist()` - prints a Slack-ready checklist of people who answered again under a different email.
- `klaviyoGet`, `klaviyoGetAll` - a GET-only Klaviyo client for new sources.

## Ad-hoc Klaviyo queries

```sh
node read-only.mjs bobby metrics --all
node read-only.mjs bobby events 'filter=equals(metric_id,"AbC123")' include=profile
```
