import { createHmac, randomUUID } from "node:crypto";

const endpointText = String(process.env.FATHOM_PREVIEW_URL || "").trim();
const secret = String(process.env.FATHOM_WEBHOOK_SECRET || "").trim();
const expectedStatus = String(
  process.env.FATHOM_SCHEMA_PROBE_EXPECTED_STATUS || "schema_configuration_required",
).trim();
if (!endpointText) throw new Error("FATHOM_PREVIEW_URL is required.");
if (!secret.startsWith("whsec_")) throw new Error("FATHOM_WEBHOOK_SECRET must be a Fathom whsec_ signing secret.");
const endpoint = new URL(endpointText);
if (endpoint.protocol !== "https:") throw new Error("FATHOM_PREVIEW_URL must use HTTPS.");

const recordingId = Date.now();
const body = JSON.stringify({
  recording_id: recordingId,
  title: "TEST Fathom schema discovery",
  recorded_by: {
    name: "Schema Probe",
    email: "schema-probe@wildvision.io",
  },
  calendar_invitees_domains_type: "one_or_more_external",
  calendar_invitees: [{
    name: "Synthetic External Attendee",
    email: "schema-probe@example.com",
    email_domain: "example.com",
    is_external: true,
  }],
  default_summary: {
    markdown_formatted: "Synthetic metadata-only schema discovery. No real meeting data.",
  },
  action_items: [],
});
const webhookId = `schema-probe-${randomUUID()}`;
const timestamp = String(Math.floor(Date.now() / 1_000));
const key = Buffer.from(secret.slice("whsec_".length), "base64");
const signature = createHmac("sha256", key)
  .update(`${webhookId}.${timestamp}.${body}`)
  .digest("base64");

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  },
  body,
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
});
const responseText = await response.text();
console.log(`Schema probe HTTP ${response.status}; synthetic recording ${recordingId}.`);
console.log(responseText);
let responseBody = {};
try {
  responseBody = JSON.parse(responseText);
} catch {
  // The status check below fails closed for a non-JSON response.
}
if (!response.ok || responseBody?.status !== expectedStatus) {
  console.error(`Expected preview status ${expectedStatus}; received ${responseBody?.status || "non-JSON response"}.`);
  process.exitCode = 1;
}
