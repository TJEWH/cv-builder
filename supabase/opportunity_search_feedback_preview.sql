-- AF-10: exact owner preview, sharing the runner's packet implementation.
-- No opportunity/application migration, runner authorization or task operation.
begin;

-- Reviewed AF-09 prerequisite definitions, fingerprinted in the isolated PG17
-- baseline. A different server formatter or modified function must be reviewed
-- and explicitly re-fingerprinted; never copy an unreviewed deployed body into
-- an authenticated public API merely because a few source anchors still match.
do $$declare expected record;actual text;begin
  for expected in select * from(values
    ('private.opportunity_feedback_time(text)','1c7af4ee877aea6283ff33dc7790fe9853718aff42d52e224c26d327b0eda6c0'),
    ('private.opportunity_feedback_url_decoded(text)','bad4eea47f7a8b3fa9cc41e193ddb8279f8fc95c0328a7d11d779e9114a4a073'),
    ('private.opportunity_feedback_safe_url(text)','b22809a5a4821aa7717f17fd1436be4105cad9c37ad2ee4d43e23529f0a64298'),
    ('private.opportunity_feedback_projection_text(text,integer)','2315093509b979998554bd50950b5f081b8203c3d8719c3731e065eecd1e3a8b'),
    ('private.opportunity_interest_metric(uuid,uuid)','cbe710d0093afefdbb1632c15976e5e3fde1e79ce3f042a4d44eed6e32481abe'),
    ('private.project_opportunity_feedback(uuid,uuid)','9d11d0bcbc21de06ae74455b481fe7ad7528a7a4a64b96d8aa9f4dc36a3e1137'),
    ('private.compile_opportunity_feedback_snapshot(uuid,uuid)','b21cc8faac90b726e8915139a40e17ad6b632756a26bea9fe7463a9f5c81d9ce')
  ) reviewed(signature,fingerprint) loop
    actual:=encode(sha256(convert_to(pg_get_functiondef(expected.signature::regprocedure),'UTF8')),'hex');
    if actual is distinct from expected.fingerprint then raise exception 'Reviewed feedback preview prerequisite differs: %',expected.signature using errcode='55000';end if;
  end loop;
end $$;

-- During account deletion a settings parent can already be gone while its
-- snapshot/review cascade events are still queued. Redact surviving scopes
-- only; never update an orphan child or recreate the deleted settings parent.
create or replace function public.job_workspace_feedback_invalidation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid; target_search uuid; semantic boolean:=false; privacy boolean:=false; redact_aggregate_context boolean:=false;
begin
  if tg_table_name='opportunity_reviews' then
    if tg_op='DELETE' then
      owner_id:=old.user_id;
      semantic:=old.state<>'unreviewed' or old.interest_rating is not null or old.interest_reasons<>'[]'::jsonb or old.feedback_excluded or old.search_feedback_approved_at is not null;
      privacy:=semantic; redact_aggregate_context:=semantic;
    elsif tg_op='INSERT' then
      owner_id:=new.user_id;
      semantic:=new.state<>'unreviewed' or new.interest_rating is not null or new.interest_reasons<>'[]'::jsonb or new.feedback_excluded or new.search_feedback_approved_at is not null;
      privacy:=new.feedback_excluded; redact_aggregate_context:=new.feedback_excluded;
    else
      owner_id:=new.user_id;
      semantic:=(new.state,new.interest_rating,new.interest_reasons,new.feedback_excluded,new.prediction_baseline,
        new.search_feedback_approved_at,new.search_feedback_approved_summary_hash,new.search_feedback_approved_source_hash)
        is distinct from (old.state,old.interest_rating,old.interest_reasons,old.feedback_excluded,old.prediction_baseline,
        old.search_feedback_approved_at,old.search_feedback_approved_summary_hash,old.search_feedback_approved_source_hash);
      privacy:=new.feedback_excluded or (old.search_feedback_approved_at is not null and
        (new.search_feedback_approved_at,new.search_feedback_approved_summary_hash,new.search_feedback_approved_source_hash)
        is distinct from (old.search_feedback_approved_at,old.search_feedback_approved_summary_hash,old.search_feedback_approved_source_hash));
      redact_aggregate_context:=new.feedback_excluded and not old.feedback_excluded;
    end if;
  elsif tg_table_name='applications' then
    if tg_op='DELETE' then owner_id:=old.user_id; semantic:=true;
    elsif tg_op='INSERT' then owner_id:=new.user_id;
      semantic:=isfinite(new.submitted_at) or new.status='submitted' or jsonb_path_exists(new.status_history,'$[*] ? (@.status == "submitted")');
    else owner_id:=new.user_id;
      semantic:=(new.submitted_at,new.status='submitted',jsonb_path_query_array(new.status_history,'$[*] ? (@.status == "submitted")'))
        is distinct from (old.submitted_at,old.status='submitted',jsonb_path_query_array(old.status_history,'$[*] ? (@.status == "submitted")'));
    end if;
  elsif tg_table_name='opportunity_search_adaptive_settings' then
    owner_id:=new.user_id; target_search:=new.search_id;
    semantic:=tg_op='INSERT' or new.structured_feedback_enabled is distinct from old.structured_feedback_enabled;
    privacy:=semantic and not new.structured_feedback_enabled;
  end if;
  if semantic then
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id and (target_search is null or search_id=target_search);
  end if;
  if privacy then
    update public.opportunity_search_feedback_snapshots s set packet=s.packet||'{"privacy_scope_changed":true}'::jsonb,
      redact_aggregates=s.redact_aggregates or redact_aggregate_context
      where s.user_id=owner_id and (target_search is null or s.search_id=target_search)
        and exists(select 1 from public.opportunity_search_adaptive_settings parent
          where parent.user_id=s.user_id and parent.search_id=s.search_id);
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_feedback_invalidation() from public,anon,authenticated,service_role;

-- This cache contains independently verified technical proof only. It exists
-- so an invoker owner preview never needs access to private merge audit images.
create table public.opportunity_feedback_prediction_proofs (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null,
  source_kind text not null check(source_kind in ('historical_snapshot','discovery_assessment')),
  source_ref text not null,
  run_id uuid not null,
  item_id uuid not null,
  discovery_id uuid,
  score numeric not null check(score between 0 and 10),
  scale_min numeric not null check(scale_min=0),
  scale_max numeric not null check(scale_max=10),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  verified_at timestamptz not null check(isfinite(verified_at)),
  primary key(user_id,source_kind,source_ref)
);
create index opportunity_feedback_prediction_proofs_item on public.opportunity_feedback_prediction_proofs(run_id,item_id);
create index opportunity_feedback_prediction_proofs_candidate on public.opportunity_feedback_prediction_proofs(user_id,opportunity_id,recorded_at,discovery_id)
  where source_kind='discovery_assessment';
alter table public.opportunity_feedback_prediction_proofs enable row level security;
revoke all on public.opportunity_feedback_prediction_proofs from public,anon,authenticated,service_role;
grant select on public.opportunity_feedback_prediction_proofs to authenticated;
create policy "Owner prediction proof metadata" on public.opportunity_feedback_prediction_proofs for select to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

-- Read only the exact assessment paths needed to establish proof. In
-- particular, never serialize or copy an audit snapshot or assessment prose.
create function private.refresh_opportunity_feedback_prediction_proofs(p_run_id uuid,p_item_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;
begin
  if current_user<>'postgres' then raise exception 'Management proof verification required' using errcode='42501';end if;
  for owner_id in select distinct user_id from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id loop
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id;
  end loop;
  delete from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id;
  insert into public.opportunity_feedback_prediction_proofs(user_id,opportunity_id,source_kind,source_ref,run_id,item_id,
    score,scale_min,scale_max,recorded_at,verified_at)
  select r.user_id,r.opportunity_id,'historical_snapshot','opportunity-search-receipt:'||r.run_id::text||':'||r.item_id::text,r.run_id,r.item_id,
    case when jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number' then (a.after_snapshot#>>'{personal_fit,score}')::numeric end,0,10,a.recorded_at,r.verified_at
    from public.opportunity_search_receipts r join auth.users owner on owner.id=r.user_id
    join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=r.user_id
    join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=r.opportunity_id
    where r.run_id=p_run_id and r.item_id=p_item_id and r.verified_at is not null and isfinite(r.verified_at)
      and a.rolled_back_at is null and isfinite(a.recorded_at)
      and jsonb_typeof(a.after_snapshot->'personal_fit')='object' and jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number'
      and a.after_snapshot#>'{personal_fit,scale_min}'='0'::jsonb and a.after_snapshot#>'{personal_fit,scale_max}'='10'::jsonb
      and case when jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number' then (a.after_snapshot#>>'{personal_fit,score}')::numeric end between 0 and 10;
  insert into public.opportunity_feedback_prediction_proofs(user_id,opportunity_id,source_kind,source_ref,run_id,item_id,discovery_id,
    score,scale_min,scale_max,recorded_at,verified_at)
  select d.user_id,d.opportunity_id,'discovery_assessment','opportunity-discovery-assessment:'||d.discovery_id::text,d.run_id,d.item_id,d.discovery_id,
    d.assessment_score,0,10,d.assessment_recorded_at,d.assessment_verified_at
    from public.opportunity_search_discoveries d join auth.users owner on owner.id=d.user_id
    join public.opportunity_search_receipts r on r.run_id=d.run_id and r.item_id=d.item_id
      and r.user_id=d.user_id and r.opportunity_id=d.opportunity_id
    join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=d.user_id and run.search_id=d.search_id and run.protocol_version=d.assessment_version
    join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=d.opportunity_id
    where d.run_id=p_run_id and d.item_id=p_item_id and r.verified_at is not null and isfinite(r.verified_at)
      and d.assessment_verified_at=r.verified_at and a.rolled_back_at is null and d.assessment_recorded_at=a.recorded_at
      and isfinite(d.assessment_recorded_at) and d.original_assessment=r.payload->'personal_fit'
      and jsonb_typeof(d.original_assessment)='object' and jsonb_typeof(d.original_assessment->'score')='number'
      and d.original_assessment->'scale_min'='0'::jsonb and d.original_assessment->'scale_max'='10'::jsonb
      and d.original_assessment->'score'=to_jsonb(d.assessment_score)
      and d.assessment_score between 0 and 10 and d.assessment_scale_min=0 and d.assessment_scale_max=10;
  for owner_id in select distinct user_id from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id loop
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id;
  end loop;
end;
$$;
revoke all on function private.refresh_opportunity_feedback_prediction_proofs(uuid,uuid) from public,anon,authenticated,service_role;

create function private.maintain_opportunity_feedback_prediction_proofs() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then perform private.refresh_opportunity_feedback_prediction_proofs(old.run_id,old.item_id);return old;end if;
  if tg_op='UPDATE' and(new.run_id,new.item_id) is distinct from(old.run_id,old.item_id) then
    perform private.refresh_opportunity_feedback_prediction_proofs(old.run_id,old.item_id);
  end if;
  perform private.refresh_opportunity_feedback_prediction_proofs(new.run_id,new.item_id);return new;
end;
$$;
revoke all on function private.maintain_opportunity_feedback_prediction_proofs() from public,anon,authenticated,service_role;
create trigger opportunity_feedback_prediction_audit after insert or update or delete on private.opportunity_search_merge_audit
  for each row execute function private.maintain_opportunity_feedback_prediction_proofs();
create trigger opportunity_feedback_prediction_receipt after insert or update or delete on public.opportunity_search_receipts
  for each row execute function private.maintain_opportunity_feedback_prediction_proofs();
create trigger opportunity_feedback_prediction_discovery after insert or update or delete on public.opportunity_search_discoveries
  for each row execute function private.maintain_opportunity_feedback_prediction_proofs();

-- Initialize only proven metadata. Unknown history remains unknown. This is
-- deliberately independent of current catalogue scores and receipt creation.
do $$declare item record;begin
  for item in select r.run_id,r.item_id from public.opportunity_search_receipts r where r.verified_at is not null loop
    perform private.refresh_opportunity_feedback_prediction_proofs(item.run_id,item.item_id);
  end loop;
end $$;

create function public.opportunity_feedback_preview_owner(p_user_id uuid) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_user_id is null or(current_user<>'postgres' and(current_user<>'authenticated' or auth.uid() is distinct from p_user_id
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false))) then raise exception 'Feedback unavailable' using errcode='42501';end if;
end;
$$;
create function public.opportunity_feedback_preview_baseline_matches(p_baseline jsonb,p_user_id uuid,p_opportunity_id uuid,p_feedback_at timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_baseline is null or jsonb_typeof(p_baseline) is distinct from 'object'
    or p_baseline-array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref']<>'{}'::jsonb
    or not(p_baseline?&array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'])
    or jsonb_typeof(p_baseline->'source_kind') is distinct from 'string' or jsonb_typeof(p_baseline->'source_ref') is distinct from 'string'
    or jsonb_typeof(p_baseline->'predicted_at') is distinct from 'string'
    or p_baseline->>'user_id' is distinct from p_user_id::text or p_baseline->>'opportunity_id' is distinct from p_opportunity_id::text
    or jsonb_typeof(p_baseline->'score') is distinct from 'number' or p_baseline->'scale_min' is distinct from '0'::jsonb
    or p_baseline->'scale_max' is distinct from '10'::jsonb or p_feedback_at is null or not isfinite(p_feedback_at) then return false;end if;
  return exists(select 1 from public.opportunity_feedback_prediction_proofs p where p.user_id=p_user_id and p.opportunity_id=p_opportunity_id
    and p.source_kind=p_baseline->>'source_kind' and p.source_ref=p_baseline->>'source_ref' and p.score=(p_baseline->>'score')::numeric
    and p.recorded_at=public.opportunity_feedback_preview_time(p_baseline->>'predicted_at') and p.recorded_at<=p_feedback_at);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create function public.opportunity_feedback_preview_candidate(p_user_id uuid,p_opportunity_id uuid,p_before timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_before is null or not isfinite(p_before) then return null;end if;
  return(select jsonb_build_object('user_id',p.user_id,'opportunity_id',p.opportunity_id,'score',p.score,'scale_min',0,'scale_max',10,
    'predicted_at',p.recorded_at,'source_kind',p.source_kind,'source_ref',p.source_ref)
    from public.opportunity_feedback_prediction_proofs p where p.user_id=p_user_id and p.opportunity_id=p_opportunity_id
      and p.source_kind='discovery_assessment' and p.recorded_at<=p_before order by p.recorded_at,p.discovery_id limit 1);
end;
$$;

-- The remaining functions are factored from the installed reviewed algorithms
-- below. Every replacement checks the exact prerequisite; no dynamic caller
-- SQL, grants on private schema, or security-definer delegation is involved.
do $$declare body text;updated text;begin
  body:=pg_get_functiondef('private.opportunity_feedback_time(text)'::regprocedure);
  updated:=replace(body,'private.opportunity_feedback_time','public.opportunity_feedback_preview_time');
  if updated=body then raise exception 'Feedback time prerequisite differs';end if;execute updated;

  body:=pg_get_functiondef('private.opportunity_feedback_url_decoded(text)'::regprocedure);
  updated:=replace(body,'private.opportunity_feedback_url_decoded','public.opportunity_feedback_preview_url_decoded');
  if updated=body or position('private.' in updated)>0 then raise exception 'Feedback URL decoding prerequisite differs';end if;execute updated;
  body:=pg_get_functiondef('private.opportunity_feedback_safe_url(text)'::regprocedure);
  updated:=replace(body,'private.opportunity_feedback_safe_url','public.opportunity_feedback_preview_url');
  updated:=replace(updated,'private.opportunity_feedback_url_decoded','public.opportunity_feedback_preview_url_decoded');
  if updated=body or position('private.' in updated)>0 then raise exception 'Feedback URL prerequisite differs';end if;execute updated;

  body:=pg_get_functiondef('private.opportunity_feedback_projection_text(text,integer)'::regprocedure);
  updated:=replace(body,'private.opportunity_feedback_projection_text','public.opportunity_feedback_preview_text');
  if updated=body or position('private.' in updated)>0 then raise exception 'Feedback text prerequisite differs';end if;execute updated;

  body:=pg_get_functiondef('private.opportunity_interest_metric(uuid,uuid)'::regprocedure);
  updated:=replace(body,'private.opportunity_interest_metric','public.opportunity_feedback_preview_metric');
  updated:=replace(updated,'private.opportunity_feedback_time','public.opportunity_feedback_preview_time');
  updated:=replace(updated,'private.opportunity_feedback_baseline_matches','public.opportunity_feedback_preview_baseline_matches');
  updated:=replace(updated,'private.opportunity_discovery_prediction_candidate','public.opportunity_feedback_preview_candidate');
  updated:=replace(updated,'begin'||chr(10),'begin'||chr(10)||'  perform public.opportunity_feedback_preview_owner(p_user_id);'||chr(10));
  if updated=body or position('private.' in updated)>0 or position('perform public.opportunity_feedback_preview_owner' in updated)=0 then
    raise exception 'Feedback metric prerequisite differs';end if;execute updated;

  body:=pg_get_functiondef('private.project_opportunity_feedback(uuid,uuid)'::regprocedure);
  updated:=replace(body,'private.project_opportunity_feedback','public.project_opportunity_feedback_preview');
  updated:=replace(updated,'private.opportunity_interest_metric','public.opportunity_feedback_preview_metric');
  updated:=replace(updated,'private.opportunity_feedback_time','public.opportunity_feedback_preview_time');
  updated:=replace(updated,'private.opportunity_discovery_prediction_candidate','public.opportunity_feedback_preview_candidate');
  updated:=replace(updated,'private.opportunity_feedback_projection_text','public.opportunity_feedback_preview_text');
  updated:=replace(updated,'private.opportunity_feedback_safe_url','public.opportunity_feedback_preview_url');
  updated:=replace(updated,'begin'||chr(10),'begin'||chr(10)||'  perform public.opportunity_feedback_preview_owner(p_user_id);'||chr(10));
  if updated=body or position('private.' in updated)>0 or position('perform public.opportunity_feedback_preview_owner' in updated)=0 then
    raise exception 'Feedback projection prerequisite differs';end if;execute updated;
end $$;

-- Factor the installed packet algorithm rather than maintain a second preview
-- implementation. All source changes are anchored and fail closed. This builder
-- only reads owner RLS data; the private compiler retains publication authority.
do $$declare body text;updated text;anchor text;begin
  body:=pg_get_functiondef('private.compile_opportunity_feedback_snapshot(uuid,uuid)'::regprocedure);
  if position('settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused' in body)=0
    or position('preferences:=public.opportunity_search_preference_document' in body)=0 then raise exception 'AF-06 compiler prerequisite differs';end if;
  updated:=replace(body,'private.compile_opportunity_feedback_snapshot','public.build_opportunity_search_feedback');
  updated:=replace(updated,'private.project_opportunity_feedback','public.project_opportunity_feedback_preview');
  updated:=replace(updated,'begin'||chr(10),'begin'||chr(10)||'  perform public.opportunity_feedback_preview_owner(p_user_id);'||chr(10));
  anchor:='  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;';
  if position(anchor in updated)=0 then raise exception 'Feedback settings initialization differs';end if;
  updated:=replace(updated,anchor,'');
  anchor:='  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;';
  if position(anchor in updated)=0 then raise exception 'Feedback settings lookup differs';end if;
  updated:=replace(updated,anchor,'  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  if not found then settings.structured_feedback_enabled:=false;settings.consent_revision:=0;settings.feedback_revision:=0;
    settings.adaptation_enabled:=false;settings.adaptation_paused:=false;settings.adaptation_revision:=0;end if;');
  anchor:='    update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=prior.feedback_revision,feedback_input_fingerprint=fingerprint
      where user_id=p_user_id and search_id=p_search_id;';
  if position(anchor in updated)=0 then raise exception 'Feedback cache publication differs';end if;updated:=replace(updated,anchor,'');
  anchor:='  insert into public.opportunity_search_feedback_snapshots(user_id,search_id,feedback_revision,input_fingerprint,packet)
    values(p_user_id,p_search_id,revision,fingerprint,packet);
  update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=revision,feedback_input_fingerprint=fingerprint
    where user_id=p_user_id and search_id=p_search_id;';
  if position(anchor in updated)=0 then raise exception 'Feedback packet publication differs';end if;updated:=replace(updated,anchor,'');
  if position('private.' in updated)>0 or updated=body or position('perform public.opportunity_feedback_preview_owner' in updated)=0 then
    raise exception 'Feedback builder factorization failed';end if;execute updated;
end $$;

create function public.preview_opportunity_search_feedback(p_search_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin return public.build_opportunity_search_feedback(auth.uid(),p_search_id);end;
$$;

create or replace function private.compile_opportunity_feedback_snapshot(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare packet jsonb;
begin
  if current_user<>'postgres' then raise exception 'Management publication required' using errcode='42501';end if;
  if p_user_id is null or p_search_id is null or not exists(select 1 from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id) then
    raise exception 'Search unavailable' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':feedback',0));
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;
  perform 1 from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;
  packet:=public.build_opportunity_search_feedback(p_user_id,p_search_id);
  insert into public.opportunity_search_feedback_snapshots(user_id,search_id,feedback_revision,input_fingerprint,packet)
    values(p_user_id,p_search_id,(packet->>'feedback_revision')::bigint,packet->>'input_fingerprint',packet) on conflict(user_id,search_id,input_fingerprint) do nothing;
  update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=(packet->>'feedback_revision')::bigint,
    feedback_input_fingerprint=packet->>'input_fingerprint' where user_id=p_user_id and search_id=p_search_id;
  return packet;
end;
$$;
revoke all on function private.compile_opportunity_feedback_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.opportunity_feedback_preview_owner(uuid),public.opportunity_feedback_preview_time(text),
  public.opportunity_feedback_preview_url_decoded(text),public.opportunity_feedback_preview_url(text),
  public.opportunity_feedback_preview_baseline_matches(jsonb,uuid,uuid,timestamptz),public.opportunity_feedback_preview_candidate(uuid,uuid,timestamptz),
  public.opportunity_feedback_preview_text(text,integer),public.opportunity_feedback_preview_metric(uuid,uuid),public.project_opportunity_feedback_preview(uuid,uuid),
  public.build_opportunity_search_feedback(uuid,uuid),public.preview_opportunity_search_feedback(uuid) from public,anon,service_role;
grant execute on function public.opportunity_feedback_preview_owner(uuid),public.opportunity_feedback_preview_time(text),
  public.opportunity_feedback_preview_url_decoded(text),public.opportunity_feedback_preview_url(text),
  public.opportunity_feedback_preview_baseline_matches(jsonb,uuid,uuid,timestamptz),public.opportunity_feedback_preview_candidate(uuid,uuid,timestamptz),
  public.opportunity_feedback_preview_text(text,integer),public.opportunity_feedback_preview_metric(uuid,uuid),public.project_opportunity_feedback_preview(uuid,uuid),
  public.build_opportunity_search_feedback(uuid,uuid),public.preview_opportunity_search_feedback(uuid) to authenticated;
comment on table public.opportunity_feedback_prediction_proofs is 'Owner-readable verified technical prediction proof. No audit snapshots, assessment prose, contacts or private application context.';
comment on function public.preview_opportunity_search_feedback(uuid) is 'Read-only exact current or next runner feedback packet. Does not approve sharing or create a run.';
commit;
