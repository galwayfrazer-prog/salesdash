# Fathom Post-Call Preview Pilot

Status: local implementation ready for a TEST-record pilot. This phase is read-only in Zoho and has no approval or write endpoint.

## What it does

1. Accepts only signed Fathom `new_meeting_content_ready` webhook deliveries.
2. Stores a bounded meeting preview, action items and external calendar invitees in service-only Supabase tables. It does not retain the raw payload or transcript.
3. Resolves each external attendee by exact email only: Contact -> Creator -> related Deals.
4. Marks a preview `ready_for_review` only when every external attendee converges on one Creator and one explicitly active Deal.
5. Lets an authenticated Sales OS manager inspect the result through a protected read endpoint.

It never calls a Zoho mutation method or the Notes API. `ZOHO_WRITE_MODE` must remain `disabled` or processing fails closed.

## Required server secrets

- `FATHOM_WEBHOOK_SECRET`: the `whsec_...` signing secret stored in Supabase, never in the repository.
- `FATHOM_INTERNAL_DOMAINS=wildvision.io`
- `ZOHO_WRITE_MODE=disabled`
- Existing Supabase server secrets used by the Sales OS functions.
- A dedicated Zoho credential in `ZOHO_PREVIEW_CLIENT_ID` and `ZOHO_PREVIEW_CLIENT_SECRET`, with READ access only to Contacts, Deals, the Creator custom module, module/field/layout/related-list metadata and secure search. Do not grant Notes or record-write scopes. The preview function deliberately does not reuse `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` or `ZOHO_REFRESH_TOKEN`.
- Either a dedicated `ZOHO_PREVIEW_REFRESH_TOKEN`, or `ZOHO_PREVIEW_CRM_ORG_ID` plus the client-credentials scope below.
- `ZOHO_PREVIEW_READ_SCOPE`: required only for Zoho client-credentials auth.
- `ZOHO_PREVIEW_SCHEMA_JSON`: added only after the discovery step below.
- Optional `FATHOM_PREVIEW_REVIEWER_EMAILS`: comma-separated `@wildvision.io` reviewers; Sales OS managers are already allowed.

## Deploy and discover the schema

1. Apply `202608110001_fathom_post_call_preview.sql`.
2. Deploy `fathom-webhook-preview` and `get-fathom-post-call-previews`. Both use custom authentication checks, so their Supabase gateway JWT verification is disabled in `supabase/config.toml`.
3. Keep `ZOHO_PREVIEW_SCHEMA_JSON` unset. Do not point Fathom at the endpoint yet.
4. In a local shell, set `FATHOM_PREVIEW_URL` to `https://<project-ref>.supabase.co/functions/v1/fathom-webhook-preview`, set `FATHOM_SCHEMA_PROBE_EXPECTED_STATUS=schema_configuration_required`, and load `FATHOM_WEBHOOK_SECRET` without printing it. Run `npm run probe:fathom-schema`.
5. The signed probe uses a fresh synthetic recording ID and reserved `example.com` attendee. The response and stored event should say `schema_configuration_required`. No Contact or Deal search runs in this discovery pass.
6. Inspect only `fathom_post_call_events.schema_snapshot` for that synthetic event. Review the exact module/field IDs, API names, per-layout relationships, target modules, hrefs and Deal stage values with the Zoho administrator.

## Pin the reviewed schema

Set `ZOHO_PREVIEW_SCHEMA_JSON` as one compact JSON secret using this shape and values copied from the reviewed snapshot:

```json
{
  "version": 1,
  "apiOrigin": "https://www.zohoapis.eu",
  "contacts": {
    "moduleId": "CONTACTS_MODULE_ID",
    "apiName": "Contacts",
    "emailFields": [
      { "id": "EMAIL_FIELD_ID", "apiName": "Email" }
    ]
  },
  "deals": {
    "moduleId": "DEALS_MODULE_ID",
    "apiName": "Deals",
    "stageField": { "id": "STAGE_FIELD_ID", "apiName": "Stage" },
    "creatorField": { "id": "DEAL_CREATOR_LOOKUP_ID", "apiName": "Creator" }
  },
  "creators": {
    "moduleId": "CREATOR_MODULE_ID",
    "apiName": "CREATOR_MODULE_API_NAME",
    "nameField": { "id": "CREATOR_NAME_FIELD_ID", "apiName": "CREATOR_NAME_FIELD_API_NAME" }
  },
  "contactCreatorRelation": {
    "mode": "lookup",
    "id": "CONTACT_CREATOR_LOOKUP_ID",
    "apiName": "CONTACT_CREATOR_LOOKUP_API_NAME"
  },
  "creatorDealsRelation": {
    "mode": "related_list",
    "id": "CREATOR_DEALS_RELATED_LIST_ID",
    "apiName": "CREATOR_DEALS_RELATED_LIST_API_NAME",
    "href": "EXACT_METADATA_HREF"
  },
  "activeStages": ["Interested", "Negotiating"]
}
```

If Contact -> Creator is a related list, use `mode: "related_list"` and include its exact `href`. If Creator -> Deals must be resolved through the Deal lookup instead, use `mode: "deal_lookup"`; the pinned `deals.creatorField` is still mandatory. Never choose a relationship by display label alone.

After setting the schema secret, set `FATHOM_SCHEMA_PROBE_EXPECTED_STATUS=no_match` and run a new probe. This post-pin probe is mandatory: `no_match` is expected because the reserved synthetic attendee has no Contact, but reaching it proves the pinned metadata passed validation. A corrected pin is always tested with another fresh synthetic recording ID. Disable or repoint the old `fathom-webhook-test` subscription so one meeting cannot hit both handlers, then configure the TEST Fathom webhook subscription for `fathom-webhook-preview`. Ordinary duplicate deliveries return the stored result and do not query Zoho again.

Fathom currently documents no general webhook resend endpoint, and an old captured request fails the five-minute signature window. Do not base the rollout on resending an acknowledged real meeting.

The pilot does not automatically steal a `processing` claim. If an Edge invocation is terminated before it records a final status, investigate the event, delete only that synthetic event after confirming its exact ID, and run a fresh synthetic probe. Do not run two manual probes with the same recording ID.

## Pilot acceptance checks

- A unique TEST Contact -> Creator -> active Deal chain becomes `ready_for_review`.
- No Contact, no Creator, no related Deals and no active Deals each produce an inspectable no-match reason.
- Duplicate Contacts, multiple Creators, multiple active Deals, shared mailboxes and multi-attendee disagreement all fail closed as ambiguous or partial.
- An unknown or blank Deal stage is `unclassified_stage` and is never eligible.
- Replaying a completed webhook does not create duplicate events, attendees or candidates.
- A changed body reusing the same `webhook-id` is rejected as `WEBHOOK_ID_PAYLOAD_CONFLICT`.
- Function logs contain IDs, counts and status codes only; no attendee email, summary, token or secret.
- No Zoho record changes and no Note is created.

Delete each synthetic probe event after its schema snapshot has been reviewed. Before allowing real meetings, schedule a daily service-role call to `purge_fathom_post_call_previews(90)` and verify the cascade removes the event, delivery, attendees and candidates. Ninety days is the default maximum retention for this preview phase.

## Read endpoint

Call `get-fathom-post-call-previews` with the signed-in Sales OS bearer token. Optional query parameters are `eventId`, `status` and `limit` (maximum 50). The response is explicitly marked `readOnly: true`.

Do not add an approval/write endpoint during this pilot. Any future write phase needs a separate human approval ledger, exact target confirmation, least-privileged write credential and an independent rollout review.
