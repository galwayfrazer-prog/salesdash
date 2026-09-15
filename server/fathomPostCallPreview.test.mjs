import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertReadOnlyZohoRequest,
  buildPreviewNote,
  cleanPreviewText,
  dealPreview,
  exactContactMatches,
  extractExternalAttendees,
  isCreatorRelatedList,
  isSharedMailbox,
  lookupRecords,
  normalizeEmail,
  parseInternalDomains,
  pinnedRelatedListMatches,
  resolvePreviewStatus,
  validFathomInviteeEnvelope,
  verifyFathomSignature,
} from "../supabase/functions/_shared/fathomPostCallPreview.mjs";

assert.equal(normalizeEmail("  Buyer@Example.COM  "), "buyer@example.com");
assert.equal(normalizeEmail("not-an-email"), "");
assert.deepEqual(parseInternalDomains("@wildvision.io, WILDVISION.IO,invalid"), ["wildvision.io"]);
assert.equal(isSharedMailbox("sales@example.com"), true);
assert.equal(isSharedMailbox("person@example.com"), false);
assert.equal(cleanPreviewText("a\u0000b\r\n", 20), "ab");

const creatorModule = { id: "creator-module-id", api_name: "Creators", module_name: "CustomModule8" };
const contactCreatorRelation = {
  id: "related-list-id",
  api_name: "Creators5",
  href: "Contacts/{ENTITYID}/Creators5",
  status: "visible",
  type: "multiselectlookup",
  connectedmodule: "CustomModule8",
  connectedlookupApiName: "Creator",
  linkingmodule: "LinkingModule5",
  module: { id: "linking-module-id", api_name: "Creators_X_Contacts" },
};
const pinnedContactCreatorRelation = {
  id: "related-list-id",
  apiName: "Creators5",
  href: "Contacts/{ENTITYID}/Creators5",
  type: "multiselectlookup",
  connectedModule: "CustomModule8",
  connectedLookupApiName: "Creator",
  linkingModule: "LinkingModule5",
  linkingModuleId: "linking-module-id",
  linkingModuleApiName: "Creators_X_Contacts",
};
assert.equal(isCreatorRelatedList(contactCreatorRelation, creatorModule), true);
assert.equal(pinnedRelatedListMatches(contactCreatorRelation, pinnedContactCreatorRelation, {
  targetModuleId: creatorModule.id,
  creatorModuleName: creatorModule.module_name,
}), true);
assert.equal(pinnedRelatedListMatches({
  ...contactCreatorRelation,
  linkingmodule: "UnexpectedLinkingModule",
}, pinnedContactCreatorRelation, {
  targetModuleId: creatorModule.id,
  creatorModuleName: creatorModule.module_name,
}), false);

const attendeePayload = {
  recorded_by: { email: "host@wildvision.io" },
  calendar_invitees: [
    { name: "Buyer", email: " Buyer@Example.com ", email_domain: "example.com", is_external: true },
    { name: "Duplicate Buyer", email: "buyer@example.com", email_domain: "example.com", is_external: true },
    { name: "Internal", email: "rep@wildvision.io", email_domain: "wildvision.io", is_external: true },
    { name: "Internal Subdomain", email: "rep@mail.wildvision.io", email_domain: "mail.wildvision.io", is_external: true },
    { name: "Recorder", email: "host@wildvision.io", email_domain: "wildvision.io", is_external: true },
    { name: "Untrusted Flag", email: "untrusted@example.net", email_domain: "example.net", is_external: false },
    { name: "Domain Mismatch", email: "mismatch@example.org", email_domain: "evil.example", is_external: true },
    { name: "Missing", email: null, email_domain: null, is_external: true },
  ],
  transcript: [
    { speaker: { matched_calendar_invitee_email: "buyer@example.com" } },
    { speaker: { matched_calendar_invitee_email: "transcript-only@example.net" } },
  ],
  action_items: [
    { description: "Follow up", assignee: { email: "buyer@example.com" } },
    { description: "Ignore as candidate", assignee: { email: "action-only@example.net" } },
  ],
};
const attendees = extractExternalAttendees(attendeePayload, { internalDomains: ["wildvision.io"] });
assert.equal(attendees.length, 1);
assert.equal(attendees[0].email, "buyer@example.com");
assert.deepEqual(attendees[0].sources, ["action_assignee", "calendar_invitee", "transcript_speaker"]);
assert.equal(attendees.some((attendee) => attendee.email === "transcript-only@example.net"), false);
assert.equal(validFathomInviteeEnvelope({
  calendar_invitees_domains_type: "one_or_more_external",
  calendar_invitees: [{ is_external: true }],
}), true);
assert.equal(validFathomInviteeEnvelope({
  calendar_invitees_domains_type: "only_internal",
  calendar_invitees: [{ is_external: true }],
}), false);
assert.equal(validFathomInviteeEnvelope({
  calendar_invitees_domains_type: "unexpected",
  calendar_invitees: [],
}), false);

const exactMatches = exactContactMatches([
  { id: "1", Email: "buyer@example.com" },
  { id: "2", Email: "buyer@example.com.invalid" },
  { id: "3", Secondary_Email: "BUYER@EXAMPLE.COM" },
  { id: "3", Secondary_Email: "BUYER@EXAMPLE.COM" },
], "buyer@example.com", ["Email", "Secondary_Email"]);
assert.deepEqual(exactMatches.map((record) => record.id), ["1", "3"]);
assert.deepEqual(lookupRecords([{ id: "10", name: "Creator" }, { id: "10", name: "Duplicate" }]), [
  { id: "10", name: "Duplicate" },
]);

const eligible = dealPreview({ id: "20", Deal_Name: "Pilot", Stage: "Interested" }, {
  activeStages: ["Interested", "Negotiating"],
});
assert.equal(eligible.eligible, true);
assert.equal(eligible.reason, "active_deal");
assert.equal(dealPreview({ id: "21", Stage: "Live" }, { activeStages: ["Interested"] }).reason, "terminal_stage");
assert.equal(dealPreview({ id: "22", Stage: "Brand New Stage" }, { activeStages: ["Interested"] }).reason, "unclassified_stage");
assert.equal(dealPreview({ id: "23", Stage: "" }, { activeStages: ["Interested"] }).eligible, false);

assert.deepEqual(resolvePreviewStatus([
  { status: "matched", creatorId: "creator-1", eligibleDealIds: ["deal-1"] },
  { status: "matched", creatorId: "creator-1", eligibleDealIds: ["deal-1"] },
]), { status: "ready_for_review", reason: "single_converged_target" });
assert.equal(resolvePreviewStatus([
  { status: "matched", creatorId: "creator-1", eligibleDealIds: ["deal-1"] },
  { status: "no_contact" },
]).status, "partial_match");
assert.equal(resolvePreviewStatus([
  { status: "matched", creatorId: "creator-1", eligibleDealIds: ["deal-1"] },
  { status: "matched", creatorId: "creator-2", eligibleDealIds: ["deal-2"] },
]).status, "ambiguous");
assert.equal(resolvePreviewStatus([{ status: "ambiguous_deals" }]).status, "ambiguous");
assert.equal(resolvePreviewStatus([{ status: "no_contact" }]).status, "no_match");
assert.equal(resolvePreviewStatus([{ status: "matched", sharedMailbox: true }]).reason, "shared_mailbox_manual_review");

const note = buildPreviewNote({
  default_summary: { markdown_formatted: "Summary\u0000 text" },
  action_items: [{ description: "Send proposal" }],
}, 12345);
assert.match(note, /\[FATHOM_RECORDING_ID:12345\]/);
assert.match(note, /Preview only\. No Zoho record was changed\./);
assert.doesNotMatch(note, /\u0000/);
assert.ok(note.length <= 20_000);

const signingKey = Buffer.from("fathom-preview-test-secret");
const secret = `whsec_${signingKey.toString("base64")}`;
const webhookId = "msg_test_123";
const timestampText = "1786464000";
const rawBody = '{"recording_id":12345}';
const signature = createHmac("sha256", signingKey)
  .update(`${webhookId}.${timestampText}.${rawBody}`)
  .digest("base64");
const signatureArgs = {
  webhookId,
  timestampText,
  rawBody,
  secret,
  nowSeconds: Number(timestampText),
};
assert.equal(await verifyFathomSignature({ ...signatureArgs, signatureHeader: `v1,${signature}` }), true);
assert.equal(await verifyFathomSignature({ ...signatureArgs, signatureHeader: `v2,bad v1,${signature}` }), true);
assert.equal(await verifyFathomSignature({ ...signatureArgs, signatureHeader: "v1,bad" }), false);
assert.equal(await verifyFathomSignature({ ...signatureArgs, rawBody: `${rawBody} `, signatureHeader: `v1,${signature}` }), false);
assert.equal(await verifyFathomSignature({ ...signatureArgs, nowSeconds: Number(timestampText) + 301, signatureHeader: `v1,${signature}` }), false);

for (const allowedPath of [
  "/crm/v8/settings/modules",
  "/crm/v8/settings/fields?module=Contacts",
  "/crm/v8/settings/layouts?module=Contacts",
  "/crm/v8/settings/related_lists?module=Contacts&layout_id=123",
  "/crm/v8/Contacts/search?email=buyer%40example.com&fields=Email&page=1&per_page=200",
  "/crm/v8/Deals/search?criteria=%28Creator%3Aequals%3A123%29&fields=Deal_Name&page=1&per_page=200",
  "/crm/v8/Creators/123?fields=Channel_Name",
  "/crm/v8/Creators/123/Deals?fields=Deal_Name&page=1&per_page=200",
]) {
  assert.equal(assertReadOnlyZohoRequest("GET", allowedPath), true);
}
for (const [method, blockedPath] of [
  ["POST", "/crm/v8/Deals"],
  ["PUT", "/crm/v8/Deals/123"],
  ["GET", "/crm/v8/Notes/123"],
  ["GET", "/crm/v8/%4eotes/123"],
  ["GET", "/crm/v8/%254eotes/123"],
  ["GET", "/crm/v8/Creators/123/Notes"],
  ["GET", "/crm/v8/Creators/123/Deals?include=all"],
  ["GET", "/crm/v8/Deals"],
]) {
  assert.throws(() => assertReadOnlyZohoRequest(method, blockedPath));
}

const root = path.resolve(import.meta.dirname, "..");
const edgeSource = await readFile(
  path.join(root, "supabase", "functions", "fathom-webhook-preview", "index.ts"),
  "utf8",
);
assert.doesNotMatch(edgeSource, /\/crm\/v8\/Notes/i);
assert.doesNotMatch(edgeSource, /createTestNote|updateRecord|deleteRecord/i);
assert.equal((edgeSource.match(/method:\s*"POST"/g) || []).length, 1, "Only the OAuth token exchange may use POST.");
assert.match(edgeSource, /ZOHO_WRITE_MODE_MUST_BE_DISABLED/);
assert.match(edgeSource, /WEBHOOK_ID_PAYLOAD_CONFLICT/);
assert.match(edgeSource, /ZOHO_PREVIEW_CLIENT_ID/);
assert.match(edgeSource, /ZOHO_PREVIEW_CLIENT_SECRET/);
assert.doesNotMatch(edgeSource, /requiredEnv\("ZOHO_CLIENT_ID"\)|requiredEnv\("ZOHO_CLIENT_SECRET"\)/);

const readerSource = await readFile(
  path.join(root, "supabase", "functions", "get-fathom-post-call-previews", "index.ts"),
  "utf8",
);
assert.match(readerSource, /requireSalesOsMember/);
assert.match(readerSource, /member\.role === "manager"/);
assert.match(readerSource, /FATHOM_PREVIEW_REVIEWER_EMAILS/);
assert.match(readerSource, /readOnly:\s*true/);
assert.doesNotMatch(readerSource, /ZOHO_CLIENT_SECRET|Zoho-oauthtoken|\/crm\/v8\//i);
assert.doesNotMatch(readerSource, /recorded_by_email/);

const probeSource = await readFile(
  path.join(root, "scripts", "send-fathom-preview-schema-probe.mjs"),
  "utf8",
);
assert.match(probeSource, /schema-probe@example\.com/);
assert.match(probeSource, /createHmac\("sha256"/);
assert.match(probeSource, /webhook-signature/);
assert.match(probeSource, /FATHOM_SCHEMA_PROBE_EXPECTED_STATUS/);
assert.match(probeSource, /responseBody\?\.status !== expectedStatus/);
assert.doesNotMatch(probeSource, /process\.env\.ZOHO|crm\/v8|Contacts\/search/);

const migrationSource = await readFile(
  path.join(root, "supabase", "migrations", "202608110001_fathom_post_call_preview.sql"),
  "utf8",
);
for (const table of [
  "fathom_post_call_events",
  "fathom_webhook_deliveries",
  "fathom_post_call_attendees",
  "fathom_post_call_candidates",
]) {
  assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
}
assert.match(migrationSource, /revoke all on table[\s\S]*from public, anon, authenticated/i);
assert.match(migrationSource, /purge_fathom_post_call_previews\(retention_days integer default 90\)/i);
assert.match(migrationSource, /grant execute on function public\.purge_fathom_post_call_previews\(integer\) to service_role/i);
assert.doesNotMatch(migrationSource, /raw_payload|raw_transcript/i);

const envExample = await readFile(path.join(root, ".env.example"), "utf8");
for (const name of [
  "FATHOM_WEBHOOK_SECRET",
  "ZOHO_PREVIEW_CLIENT_ID",
  "ZOHO_PREVIEW_CLIENT_SECRET",
  "ZOHO_PREVIEW_REFRESH_TOKEN",
  "ZOHO_PREVIEW_READ_SCOPE",
  "ZOHO_PREVIEW_SCHEMA_JSON",
]) {
  assert.match(envExample, new RegExp(`^${name}=$`, "m"));
}

console.log("Fathom post-call preview safety and matching tests passed.");
