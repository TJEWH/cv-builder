-- AF-03. Pure local/database compilation; no runner, task update or backfill.
-- Requires AF-01, AF-02, opportunity_feedback_projection.sql and existing runs.
begin;

alter table public.opportunity_search_adaptive_settings
  add column feedback_dirty boolean not null default true,
  add column feedback_revision bigint not null default 0 check(feedback_revision>=0),
  add column feedback_input_fingerprint text;

create table public.opportunity_search_feedback_snapshots (
  user_id uuid not null,
  search_id uuid not null,
  feedback_revision bigint not null check(feedback_revision>0),
  input_fingerprint text not null check(input_fingerprint ~ '^[0-9a-f]{64}$'),
  packet jsonb not null check(jsonb_typeof(packet)='object' and octet_length(packet::text)<=65536),
  redact_aggregates boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,search_id,feedback_revision),
  unique(user_id,search_id,input_fingerprint),
  foreign key(user_id,search_id) references public.opportunity_search_adaptive_settings(user_id,search_id) on delete cascade
);
alter table public.opportunity_search_feedback_snapshots enable row level security;
revoke all on public.opportunity_search_feedback_snapshots from public,anon,authenticated,service_role;
grant select,update on public.opportunity_search_feedback_snapshots to authenticated,service_role;
create policy "Owner feedback snapshots" on public.opportunity_search_feedback_snapshots for select to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Owner snapshot privacy redaction" on public.opportunity_search_feedback_snapshots for update to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
-- Preserve service-role invoker review/application writes through invalidation.
grant select,update on public.opportunity_search_adaptive_settings to service_role;

-- An invoker trigger may mark dirty; only management compilation publishes a
-- fingerprint/revision or clears dirty. Even a forged false cannot skip a build.
create function public.job_workspace_snapshot_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user<>'postgres' then
    if tg_op='INSERT' then
      new.feedback_revision:=0; new.feedback_input_fingerprint:=null; new.feedback_dirty:=true;
    else
      new.feedback_revision:=old.feedback_revision;
      new.feedback_input_fingerprint:=old.feedback_input_fingerprint;
      new.feedback_dirty:=old.feedback_dirty or coalesce(new.feedback_dirty,true);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_snapshot_settings() from public,anon,authenticated,service_role;
create trigger opportunity_feedback_snapshot_settings before insert or update on public.opportunity_search_adaptive_settings
  for each row execute function public.job_workspace_snapshot_settings();

-- Stored packets are immutable except deterministic removal of revoked data.
-- UPDATE never accepts a caller-provided replacement packet. Its only effect is
-- recomputing redaction of the previous packet against current owner approvals.
create function public.job_workspace_snapshot_redaction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare enabled boolean; live_consent_revision bigint; item jsonb; items jsonb:='[]'; review record; proof jsonb;
  result jsonb:=old.packet; removed boolean:=false; changed boolean:=false;
begin
  if (new.user_id,new.search_id,new.feedback_revision,new.input_fingerprint,new.created_at)
    is distinct from (old.user_id,old.search_id,old.feedback_revision,old.input_fingerprint,old.created_at) then
    raise exception 'Feedback snapshot identity and audit metadata are immutable' using errcode='23514';
  end if;
  new.redact_aggregates:=old.redact_aggregates or coalesce(new.redact_aggregates,false);
  select structured_feedback_enabled,consent_revision into enabled,live_consent_revision from public.opportunity_search_adaptive_settings
    where user_id=old.user_id and search_id=old.search_id;
  if not coalesce(enabled,false) or new.redact_aggregates then
    result:=result||jsonb_build_object('examples','[]'::jsonb,'approved_preferences','[]'::jsonb,
      'aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
      'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
        'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    changed:=new.redact_aggregates or coalesce((old.packet#>>'{counts,eligible}')::bigint,0)>0
      or coalesce((old.packet->>'consent_revision')::bigint,0) is distinct from live_consent_revision;
  else
    for item in select e.value from jsonb_array_elements(coalesce(old.packet->'examples','[]'::jsonb)) e loop
      select feedback_excluded,search_feedback_revision,search_feedback_approved_at,
        search_feedback_approved_summary_hash,search_feedback_approved_source_hash into review
        from public.opportunity_reviews where user_id=old.user_id and opportunity_id=(item->>'opportunity_id')::uuid;
      if coalesce(review.feedback_excluded,false) or (not found and
        (item->>'interest_origin' in ('explicit_rating','categorical_review') or jsonb_array_length(coalesce(item->'reasons','[]'))>0
          or item?'search_feedback_summary')) then
        removed:=true; changed:=true; continue;
      end if;
      if item?'search_feedback_summary' then
        proof:=item->'summary_approval';
        if review.search_feedback_approved_at is null or proof->>'summary_hash' is distinct from review.search_feedback_approved_summary_hash
          or proof->>'source_hash' is distinct from review.search_feedback_approved_source_hash
          or (proof->>'summary_revision')::bigint is distinct from review.search_feedback_revision
          or (proof->>'approved_at')::timestamptz is distinct from review.search_feedback_approved_at then
          item:=item-'search_feedback_summary'; changed:=true;
        end if;
      end if;
      items:=items||jsonb_build_array(item);
    end loop;
    result:=result||jsonb_build_object('examples',items);
    if removed then
      result:=result||jsonb_build_object('aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
        'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
          'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    end if;
  end if;
  if changed or coalesce((old.packet->>'privacy_scope_changed')::boolean,false)
    or new.packet->'privacy_scope_changed'='true'::jsonb then result:=result||'{"privacy_scope_changed":true}'::jsonb; end if;
  new.packet:=result;
  return new;
end;
$$;
revoke all on function public.job_workspace_snapshot_redaction() from public,anon,authenticated,service_role;
create trigger opportunity_feedback_snapshot_redaction before update on public.opportunity_search_feedback_snapshots
  for each row execute function public.job_workspace_snapshot_redaction();

create function public.job_workspace_feedback_invalidation() returns trigger
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
    update public.opportunity_search_feedback_snapshots set packet=packet||'{"privacy_scope_changed":true}'::jsonb,
      redact_aggregates=redact_aggregates or redact_aggregate_context where user_id=owner_id and (target_search is null or search_id=target_search);
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_feedback_invalidation() from public,anon,authenticated,service_role;
create trigger opportunity_reviews_feedback_invalidate after insert or update or delete on public.opportunity_reviews
  for each row execute function public.job_workspace_feedback_invalidation();
create trigger applications_feedback_invalidate after insert or update or delete on public.applications
  for each row execute function public.job_workspace_feedback_invalidation();
create trigger settings_feedback_invalidate after insert or update on public.opportunity_search_adaptive_settings
  for each row execute function public.job_workspace_feedback_invalidation();

-- Revision pins are immutable audit references, including after owner-driven
-- snapshot cleanup. They contain no cached text. The reader then returns a
-- privacy-changed empty packet rather than recreating a deleted old context.
alter table public.opportunity_search_runs add column feedback_snapshot_revision bigint,
  add column feedback_input_fingerprint text;
create function public.job_workspace_feedback_pin_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if current_user<>'postgres' then new.feedback_snapshot_revision:=null; new.feedback_input_fingerprint:=null; end if;
  elsif old.feedback_snapshot_revision is not null or current_user<>'postgres' then
    new.feedback_snapshot_revision:=old.feedback_snapshot_revision; new.feedback_input_fingerprint:=old.feedback_input_fingerprint;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_feedback_pin_guard() from public,anon,authenticated,service_role;
create trigger opportunity_runs_feedback_pin_guard before insert or update on public.opportunity_search_runs
  for each row execute function public.job_workspace_feedback_pin_guard();

create function private.compile_opportunity_feedback_snapshot(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.opportunity_search_adaptive_settings; prior public.opportunity_search_feedback_snapshots;
  rows jsonb:='[]'; item jsonb; selected jsonb:='[]'; remaining jsonb; groups jsonb; packet jsonb; counts jsonb;
  fingerprint text; revision bigint; bucket integer; round integer; picked jsonb; picked_id text; changed boolean;
  seen_ids text[]:='{}'; seen_institutions text[]:='{}'; seen_topics text[]:='{}'; group_total integer; omitted_bytes integer:=0;
begin
  if p_user_id is null or p_search_id is null or not exists(select 1 from public.opportunity_search_templates where id=p_search_id and user_id=p_user_id) then
    raise exception 'Search unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':feedback',0));
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;
  if settings.structured_feedback_enabled then
    select coalesce(jsonb_agg(e.example order by e.opportunity_id),'[]'::jsonb) into rows from (
      select candidate.opportunity_id,private.project_opportunity_feedback(p_user_id,candidate.opportunity_id)-'withheld_counts' example from (
        select opportunity_id from public.opportunity_reviews where user_id=p_user_id and not feedback_excluded
        union select opportunity_id from public.applications where user_id=p_user_id and
          (isfinite(submitted_at) or status='submitted' or jsonb_path_exists(status_history,'$[*] ? (@.status == "submitted")'))
      ) candidate
    ) e where e.example is not null;
  end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('metric_version','opportunity-interest-v1',
    'selection_policy_version','opportunity-feedback-selection-v1','user_id',p_user_id,'search_id',p_search_id,
    'consent_revision',settings.consent_revision,'structured_feedback_enabled',settings.structured_feedback_enabled,
    'preference_revision',0,'approved_preferences','[]'::jsonb,'examples',rows)::text,'UTF8')),'hex');
  select * into prior from public.opportunity_search_feedback_snapshots where user_id=p_user_id and search_id=p_search_id and input_fingerprint=fingerprint;
  if found then
    update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=prior.feedback_revision,feedback_input_fingerprint=fingerprint
      where user_id=p_user_id and search_id=p_search_id;
    return prior.packet;
  end if;
  -- Cleanup may remove settings/snapshots while run audit pins survive. Never
  -- recycle a revision that an existing run can still reference.
  select greatest(settings.feedback_revision,
    coalesce((select max(s.feedback_revision) from public.opportunity_search_feedback_snapshots s
      where s.user_id=p_user_id and s.search_id=p_search_id),0),
    coalesce((select max(r.feedback_snapshot_revision) from public.opportunity_search_runs r
      where r.user_id=p_user_id and r.search_id=p_search_id),0))+1 into revision;
  -- Aggregates cover the entire eligible set before example selection.
  select jsonb_build_object('eligible',count(*),'scored',count(*) filter(where e.value->'interest_score'<>'null'::jsonb),
    'confirmed_submissions',count(*) filter(where (e.value->>'confirmed_submission')::boolean),
    'explicit_rating',count(*) filter(where e.value->>'interest_origin'='explicit_rating'),
    'categorical_review',count(*) filter(where e.value->>'interest_origin'='categorical_review'),
    'submission_fallback',count(*) filter(where e.value->>'interest_origin'='confirmed_submission'),
    'baseline_available',count(*) filter(where e.value->>'baseline_status'='available'),
    'approved_summaries',count(*) filter(where e.value?'search_feedback_summary')) into counts from jsonb_array_elements(rows) e;
  with memberships as (
    select e.value->>'opportunity_id' id,e.value->>'interest_score' score,'institution' kind,
      translate(btrim(e.value->>'institution'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') key,null::text polarity
      from jsonb_array_elements(rows) e where e.value->>'institution' is not null
    union select e.value->>'opportunity_id',e.value->>'interest_score','topic',
      translate(btrim(t.value#>>'{}'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),null
      from jsonb_array_elements(rows) e cross join lateral jsonb_array_elements(e.value->'topics') t
    union select e.value->>'opportunity_id',e.value->>'interest_score',r.value->>'category',
      translate(btrim(coalesce(r.value->>'target',r.value->>'category')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),r.value->>'polarity'
      from jsonb_array_elements(rows) e cross join lateral jsonb_array_elements(e.value->'reasons') r
  ), grouped as (
    select kind,key,polarity,count(*) count,count(score) scored,coalesce(sum(score::numeric),0) score_sum,round(avg(score::numeric),6) mean_interest
      from memberships group by kind,key,polarity
  ) select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'key',key,'count',count,'scored',scored,'score_sum',score_sum,'mean_interest',mean_interest)
      ||case when polarity is null then '{}'::jsonb else jsonb_build_object('polarity',polarity) end
      order by kind collate "C",key collate "C",coalesce(polarity,'') collate "C"),'[]'::jsonb)
    into groups from grouped g;
  group_total:=jsonb_array_length(groups);
  select coalesce(jsonb_agg(g.value order by g.ordinality),'[]'::jsonb) into groups from jsonb_array_elements(groups) with ordinality g(value,ordinality) where g.ordinality<=64;
  -- Round-robin categories, with explicit evidence then institution/topic spread.
  for round in 1..16 loop
    changed:=false;
    for bucket in 1..4 loop
      exit when cardinality(seen_ids)>=16;
      select e.value into picked from jsonb_array_elements(rows) e
        where not (e.value->>'opportunity_id'=any(seen_ids)) and case bucket
          when 1 then coalesce((e.value->>'confirmed_submission')::boolean,false)
          when 2 then e.value->>'interest_origin' in ('explicit_rating','categorical_review') and (e.value->>'interest_score')::numeric>=8
          when 3 then (e.value->>'interest_gap')::numeric<=-2
          else (e.value->>'interest_gap')::numeric>=2 end
        order by case e.value->>'interest_origin' when 'explicit_rating' then 0 when 'categorical_review' then 1 when 'confirmed_submission' then 2 else 3 end,
          case when e.value->>'institution' is not null and not(translate(btrim(e.value->>'institution'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=any(seen_institutions)) then 0 else 1 end,
          case when exists(select 1 from jsonb_array_elements_text(e.value->'topics') t where not(translate(btrim(t),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=any(seen_topics))) then 0 else 1 end,
          e.value->>'opportunity_id' collate "C" limit 1;
      if found then
        selected:=selected||jsonb_build_array(picked); seen_ids:=array_append(seen_ids,picked->>'opportunity_id');
        if picked->>'institution' is not null then seen_institutions:=array_append(seen_institutions,translate(btrim(picked->>'institution'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')); end if;
        for picked_id in select translate(btrim(t),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') from jsonb_array_elements_text(picked->'topics') t loop seen_topics:=array_append(seen_topics,picked_id); end loop;
        changed:=true;
      end if;
    end loop;
    exit when not changed or cardinality(seen_ids)>=16;
  end loop;
  while cardinality(seen_ids)<16 loop
    select e.value into picked from jsonb_array_elements(rows) e where not(e.value->>'opportunity_id'=any(seen_ids))
      order by case e.value->>'interest_origin' when 'explicit_rating' then 0 when 'categorical_review' then 1 when 'confirmed_submission' then 2 else 3 end,
        case when e.value->>'institution' is not null and not(translate(btrim(e.value->>'institution'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=any(seen_institutions)) then 0 else 1 end,
        case when exists(select 1 from jsonb_array_elements_text(e.value->'topics') t where not(translate(btrim(t),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=any(seen_topics))) then 0 else 1 end,
        e.value->>'opportunity_id' collate "C" limit 1;
    exit when not found;
    selected:=selected||jsonb_build_array(picked);seen_ids:=array_append(seen_ids,picked->>'opportunity_id');
    if picked->>'institution' is not null then seen_institutions:=array_append(seen_institutions,translate(btrim(picked->>'institution'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')); end if;
    for picked_id in select translate(btrim(t),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') from jsonb_array_elements_text(picked->'topics') t loop seen_topics:=array_append(seen_topics,picked_id); end loop;
  end loop;
  packet:=jsonb_build_object('metric_version','opportunity-interest-v1','selection_policy_version','opportunity-feedback-selection-v1',
    'fingerprint_encoding','sha256-pg-jsonb-v1','feedback_revision',revision,'input_fingerprint',fingerprint,
    'consent_revision',settings.consent_revision,'preference_revision',0,'approved_preferences','[]'::jsonb,'privacy_scope_changed',false,
    'counts',counts||jsonb_build_object('selected',jsonb_array_length(selected),'omitted_limit',jsonb_array_length(rows)-jsonb_array_length(selected),'omitted_bytes',0,'omitted_groups',group_total-jsonb_array_length(groups)),
    'aggregates',jsonb_build_object('score_sum',(select coalesce(sum((e.value->>'interest_score')::numeric),0) from jsonb_array_elements(rows) e),
      'mean_interest',(select round(avg((e.value->>'interest_score')::numeric),6) from jsonb_array_elements(rows) e),'groups',groups),'examples',selected);
  while octet_length(packet::text)>65536 and jsonb_array_length(packet->'examples')>0 loop
    packet:=jsonb_set(packet,'{examples}',(packet->'examples')-(jsonb_array_length(packet->'examples')-1)); omitted_bytes:=omitted_bytes+1;
    packet:=jsonb_set(packet,'{counts,selected}',to_jsonb(jsonb_array_length(packet->'examples')));
    packet:=jsonb_set(packet,'{counts,omitted_bytes}',to_jsonb(omitted_bytes));
  end loop;
  while octet_length(packet::text)>65536 and jsonb_array_length(packet#>'{aggregates,groups}')>0 loop
    packet:=jsonb_set(packet,'{aggregates,groups}',(packet#>'{aggregates,groups}')-(jsonb_array_length(packet#>'{aggregates,groups}')-1));
    packet:=jsonb_set(packet,'{counts,omitted_groups}',to_jsonb(group_total-jsonb_array_length(packet#>'{aggregates,groups}')));
  end loop;
  insert into public.opportunity_search_feedback_snapshots(user_id,search_id,feedback_revision,input_fingerprint,packet)
    values(p_user_id,p_search_id,revision,fingerprint,packet);
  update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=revision,feedback_input_fingerprint=fingerprint
    where user_id=p_user_id and search_id=p_search_id;
  return packet;
end;
$$;
revoke all on function private.compile_opportunity_feedback_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function private.pin_opportunity_feedback_snapshot(p_user_id uuid,p_search_id uuid,p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.opportunity_search_runs; packet jsonb;
begin
  select * into run from public.opportunity_search_runs where id=p_run_id and user_id=p_user_id and search_id=p_search_id for update;
  if not found then raise exception 'Search run unavailable' using errcode='42501'; end if;
  if run.feedback_snapshot_revision is null then
    packet:=private.compile_opportunity_feedback_snapshot(p_user_id,p_search_id);
    update public.opportunity_search_runs set feedback_snapshot_revision=(packet->>'feedback_revision')::bigint,feedback_input_fingerprint=packet->>'input_fingerprint' where id=p_run_id;
    return packet;
  end if;
  -- Trigger-backed eager redaction also protects direct owner SELECTs. Revalidate
  -- here for management retry/resume after any cascade cleanup.
  update public.opportunity_search_feedback_snapshots s set packet=s.packet
    where s.user_id=p_user_id and s.search_id=p_search_id and s.feedback_revision=run.feedback_snapshot_revision
      and s.input_fingerprint=run.feedback_input_fingerprint returning s.packet into packet;
  if found then return packet; end if;
  return jsonb_build_object('metric_version','opportunity-interest-v1','selection_policy_version','opportunity-feedback-selection-v1',
    'fingerprint_encoding','sha256-pg-jsonb-v1','feedback_revision',run.feedback_snapshot_revision,'input_fingerprint',run.feedback_input_fingerprint,
    'consent_revision',0,'preference_revision',0,'approved_preferences','[]'::jsonb,'privacy_scope_changed',true,
    'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,'submission_fallback',0,
      'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0),
    'aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),'examples','[]'::jsonb);
end;
$$;
revoke all on function private.pin_opportunity_feedback_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
comment on table public.opportunity_search_feedback_snapshots is 'Immutable owner-scoped safe packets; only deterministic privacy redaction may change cached text. No contacts, comments or documents.';
commit;
