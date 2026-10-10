# Legacy CV adjustments with ChatGPT

The main application workflow is now [joint CV/letter refinement](REFINEMENT.md), organized as **Preparation → Refinement → PDF review → Tracking**. Selecting a variant creates an independent application CV, and the selected letter-template revision is frozen. Library changes do not alter application copies. Manual edits and accepted refinements stay with their application. After approving the final CV, **Save as new variant** creates an independent reusable library copy.

This document preserves the separate **legacy CV-adjustment API** and its public-field/token contract. Older clients and stored requests/responses remain supported. The former standalone adjustment component is no longer present. The app's earlier-history view can read and export archived CV requests and proposals; it cannot apply them to working documents.

## Current application workflow

Select CV and letter templates and attach supporting files in Preparation. Copy the initial refinement prompt into ChatGPT with the existing project Supabase MCP. ChatGPT reads one exact prepared request and saves a joint proposal through private management functions. Return to the app to check the summary and wording, explicitly open the proposal, edit minor issues or save feedback for another round. Each round carries current anonymized wording and all earlier replies. Approve CV and letter separately; later rounds leave approved documents unchanged until reopened. Optional letter examples guide style only, and word-limit warnings remain advisory. Review/export the combined PDF, submit manually and update Tracking. Supporting files remain local throughout.

## Legacy external client workflow

1. Prepare an application-specific privacy snapshot using the legacy public-field contract below. Only visible, non-excluded text fields belong in the request. Apply automatic contact/field masks, then the user's explicit field replacements from **CV Studio → Privacy**. Review the resulting prose before sharing it; punctuation has no special masking meaning. The local sparse replacement map and original text stay off the wire.
2. Publish through the owner-authenticated legacy RPC. Publishing stores the request; it does not run ChatGPT.
3. Ask the external client to return the specified JSON response. An authenticated integration can append it to Supabase using the legacy response RPC.
4. Keep the exact private source and token mappings locally. Any client that applies returned changes must validate and reconstruct them against that source before the owner accepts them. The current app starts new work through the shared refinement flow and exposes old records only in its archive view.

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

An existing developer Supabase connection normally lacks the app user's JWT and cannot call these **legacy owner-authenticated RPCs**. For a legacy adjustment request, it can read the exact selected snapshot and return JSON for local paste/import. Do not impersonate an app user or broaden these legacy grants.

The main refinement flow has a separate supported MCP write path: `private.read_refinement_request(request_id)` and `private.save_refinement_proposal(request_id, proposal_id, proposal)`, restricted to the management `postgres` role. These new invoker helpers derive ownership from the immutable request and append a validated joint proposal; browser users can read their own proposals but cannot write them. The existing MCP connection retains its project-wide administrative capabilities. See [the refinement contract](REFINEMENT.md); the old CV-adjustment tables and triggers remain unchanged.

## What remains local

The full baseline CV, local variant ID, field paths and private token mappings stay in browser storage. They are never part of the published request. Styles, structure, identity and untouched fields come from that local baseline when the app reconstructs the edited CV.

If a legacy source CV has changed since its request, local reconstruction rejects the response and requires a new snapshot. The unified workflow checks the entire application baseline and includes manual corrections in later rounds. A response cannot edit a different request, relocate a private placeholder or change the CV structure. No incoming response silently replaces a career variant or application document.

Cloud snapshots cannot restore private information after browser storage is cleared or on another device. Keep application document backups and separate supporting-file/package backups. Legacy tailored application copies and restored backups remain independent; selecting a new template is explicit.

[`tests/cv_adjustments.sql`](tests/cv_adjustments.sql) verifies validation, immutable history, retries, ownership, direct-write enforcement and deletion cascades using synthetic fixtures inside a transaction that rolls back.
