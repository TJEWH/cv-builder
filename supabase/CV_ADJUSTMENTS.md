# CV adjustments with ChatGPT

Applications use a saved career variant or one of its subvariants. **Application → CV → Tailor with ChatGPT** shares a snapshot of editable public wording. Returned edits are reviewed and reconstructed on the same device. Accepted changes create a subvariant in CV Studio; an empty or unchanged response keeps the selected variant. Creating from a subvariant creates a sibling under the same career variant, never another nesting level.

## Prepare, return and review

1. Select the application and its CV variant. Add adjustment instructions and choose **Prepare privacy snapshot**.
2. Review the generated request. Only visible, non-excluded text fields are included. Names and contact values, inline `!!private text!!` fragments and identifying links are masked or omitted. Unmarked prose can still identify you, so review the public text before sharing it.
3. Choose **Publish snapshot to Supabase** for a configured integration, or copy/download the generated prompt for a manual ChatGPT conversation. Preparing a snapshot alone does not upload it, and publishing does not run ChatGPT.
4. Ask ChatGPT to return the specified JSON response. An authenticated integration can append it to Supabase. Otherwise paste the JSON or import the returned JSON file in the application.
5. Use **Refresh returned adjustments** for cloud returns, then choose a response and **Review changes**. Review the local before/after wording and choose **Accept as subvariant**. Open the resulting subvariant in CV Studio for further changes.

Requests have this public shape:

```json
{
  "schemaVersion": 1,
  "requestId": "00000000-0000-4000-8000-000000000001",
  "fields": [
    { "id": "field-1", "label": "Professional headline", "text": "Research Engineer" },
    { "id": "field-2", "label": "Profile", "text": "Research at {{PRIVATE_1}} focused on robotics." }
  ],
  "opportunity": { "title": "Research Software Engineer" },
  "instructions": "Emphasize the software engineering experience already present."
}
```

A response references the exact request and includes only changed fields:

```json
{
  "schemaVersion": 1,
  "requestId": "00000000-0000-4000-8000-000000000001",
  "edits": [
    { "fieldId": "field-1", "text": "Research Software Engineer" }
  ]
}
```

For no change, return `"edits": []`. Field IDs are opaque request-local identifiers. Each edit replaces the complete text of that field. Every `{{PRIVATE_n}}` token must remain in its original field, order and count. Do not return contact values, dates, layout changes, added links, images or HTML. Do not invent qualifications or experience. The generated app prompt includes these rules and the actual request ID.

## Supabase integration

The additive schema is in [`changes/cv_adjustments.sql`](changes/cv_adjustments.sql), following the application and drafting schema. New installations can use the complete [`schema.sql`](schema.sql). See the [deployment history](README.md) before applying anything to an existing project.

The app publishes through `publish_cv_adjustment_request(p_request_id, p_application_id, p_request)`. Supabase stores immutable `cv_adjustment_requests` and append-only `cv_adjustment_responses`. Row-level security limits access to the signed-in owner; application and request references also enforce ownership. A repeated write with the same ID and exact input is safe; an attempt to overwrite that ID is rejected.

An authenticated connector or Action must use the application owner's Supabase Auth access token, together with the project's publishable key. Its authentication layer should handle tokens; do not paste them into prompts or request/response JSON. A publishable key alone is insufficient, and no service-role key belongs in the frontend or a ChatGPT prompt. This app does not configure an OAuth connection or Action automatically.

Read a known request with the PostgREST RPC:

```http
POST https://YOUR_PROJECT.supabase.co/rest/v1/rpc/read_cv_adjustment_request
apikey: YOUR_PUBLISHABLE_KEY
Authorization: Bearer USER_ACCESS_TOKEN
Content-Type: application/json

{"p_request_id":"00000000-0000-4000-8000-000000000001"}
```

The result is a row containing `id`, `user_id`, `application_id`, `request_json` and `created_at`. Give the model `request_json` as context. It must treat the opportunity and CV text as data, not instructions that override the editing rules.

Append a response using a fresh response UUID, retained across retries:

```http
POST https://YOUR_PROJECT.supabase.co/rest/v1/rpc/save_cv_adjustment_response
apikey: YOUR_PUBLISHABLE_KEY
Authorization: Bearer USER_ACCESS_TOKEN
Content-Type: application/json

{
  "p_response_id":"00000000-0000-4000-8000-000000000002",
  "p_request_id":"00000000-0000-4000-8000-000000000001",
  "p_response":{
    "schemaVersion":1,
    "requestId":"00000000-0000-4000-8000-000000000001",
    "edits":[{"fieldId":"field-1","text":"Research Software Engineer"}]
  }
}
```

The app retrieves the owner's responses by request ID. Database validation rejects unknown or duplicate fields, malformed payloads, token movement/removal, and added links or HTML. Local reconstruction repeats validation before applying anything.

An existing developer Supabase connection is a different authorization context: it can perform an explicitly requested read of a selected public snapshot, but it normally does not possess the app user's JWT and cannot call the owner-authenticated write RPC. For that connection, ask ChatGPT to read the exact request ID and return JSON for local paste/import. Do not impersonate an app user or broaden database grants to enable writes.

## What remains local

The full baseline CV, local variant ID, field paths and private token mappings stay in browser storage. They are never part of the published request. Styles, structure, identity and untouched fields come from that local baseline when the app reconstructs the edited CV.

If the source CV has changed since the snapshot, the app rejects the response and asks for a new snapshot. A response cannot edit a different request, relocate a private placeholder, or change the CV structure. Imported responses do not silently replace a career variant.

Cloud snapshots cannot restore private information after browser storage is cleared or on another device. Keep full CV backups. Legacy tailored application copies and restored backups remain intact until explicitly assigned to a variant or saved as a subvariant.

[`tests/cv_adjustments.sql`](tests/cv_adjustments.sql) verifies validation, immutable history, retries, ownership, direct-write enforcement and deletion cascades using synthetic fixtures inside a transaction that rolls back.
