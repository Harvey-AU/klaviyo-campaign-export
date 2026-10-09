# klaviyo-campaign-export

Snapshots a storefront campaign's responses from Klaviyo into a Google Sheet, for picking winners.
Brand-agnostic: each brand is one gitignored env file.

## Setup

Requires Node 21.7+ and the `gsheet` CLI on `PATH`, logged in (`gsheet login`).

For each brand, copy `.env.example` to `brands/<brand>.env` and fill it in:

```sh
KLAVIYO_PRIVATE_API_KEY=pk_...          # read-only private key
CAMPAIGN_EXPORT_CAMPAIGN=round-1-new-can-colour
CAMPAIGN_EXPORT_SHEET=https://docs.google.com/spreadsheets/d/<id>/edit
CAMPAIGN_EXPORT_EXCLUDE_DOMAINS=brand.com,teamharvey.co
CAMPAIGN_EXPORT_SAME_PERSON=brands/<brand>.same-person.json
```

Everything in `brands/` is gitignored, because it holds API keys and customer emails.

## `campaign-export.mjs`

```sh
node campaign-export.mjs --brand bobby --dry-run
node campaign-export.mjs --brand bobby
node campaign-export.mjs --brand bobby --campaign round-2-... --sheet <url>
```

Flags override the brand's env values.

- Reads `Bloom Campaign Response` events (`--metric`) whose `campaign` property matches.
- **Campaign** tab: every submission, oldest first, with a Status of `Counted`, `Duplicate` or `Internal`.
- One tab per answer option: counted submissions only, ranked by submit time, with the first `--top` (default 50) highlighted.
- A person counts once, using their first submission; later answers become `Duplicate`.
  People are matched by email, with `+` aliases merged (`hey+1@x.com` is `hey@x.com`).
- The same-person file lists people known to use more than one email, one group per person: `[["a@x.com", "a@y.com"]]`.
- Emails at `--exclude-domains` are marked `Internal` and never ranked.
- Times are shown in `--timezone` (default `Australia/Sydney`).

Each run clears and rewrites the tabs it owns.
Other tabs are left alone.

## `read-only.mjs`

A Klaviyo API client that only issues GET requests, with pagination (`--all`) and rate-limit retries.

```sh
node read-only.mjs --brand bobby metrics --all
node read-only.mjs --brand bobby events 'filter=equals(metric_id,"AbC123")' include=profile
```
