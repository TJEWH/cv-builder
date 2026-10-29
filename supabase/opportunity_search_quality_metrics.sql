-- AF-05 owner dashboard metrics. Install after opportunity_search_attribution.sql.
-- No grants on private helpers, no SECURITY DEFINER, no production backfill.
begin;
create function public.read_opportunity_search_metrics(p_search_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required' using errcode='42501';
  end if;
  if p_search_id is null or not exists(select 1 from public.opportunity_search_templates s where s.id=p_search_id and s.user_id=actor) then
    raise exception 'Search unavailable' using errcode='42501';
  end if;
  with
  owned_runs as materialized (
    select r.id,r.status,r.execution_expectations,r.execution_report_status,jsonb_array_length(r.execution_backlog) backlog,
      r.execution_backlog_omitted omitted,r.execution_report_overflow overflow
      from public.opportunity_search_runs r where r.user_id=actor and r.search_id=p_search_id
  ), executions as materialized (
    select e.run_id,e.check_id,e.kind,e.query_id,e.text_hash,e.source_registry_id,e.attempted_at,e.status,e.results_count
      from public.opportunity_search_executions e where e.user_id=actor and e.search_id=p_search_id
  ), discoveries as materialized (
    select d.discovery_id,d.opportunity_id,d.run_id,d.execution_refs,d.primary_check_id,d.primary_discovery,d.discovered_at,
      d.institution,d.topics,d.recommendation_eligible,d.recommendation_generated,d.updated_only
      from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=p_search_id and d.verified_at is not null
  ), paths as materialized (
    select d.discovery_id,d.opportunity_id,e.run_id,e.check_id,e.query_id,e.text_hash,e.source_registry_id,e.attempted_at
      from discoveries d join executions e on e.run_id=d.run_id and e.check_id=any(d.execution_refs)
      where e.status in('complete','partial','paginated','dynamic') and (e.results_count is null or e.results_count>0)
  ), discovery_facts as materialized (
    select d.discovery_id,d.opportunity_id,d.institution,d.topics,d.recommendation_eligible,d.recommendation_generated,d.updated_only,
      d.primary_check_id,
      d.primary_discovery and d.discovered_at is not null and exists(select 1 from paths p where p.discovery_id=d.discovery_id
        and p.check_id=d.primary_check_id and p.attempted_at<=d.discovered_at) is_primary,
      d.discovered_at is not null and exists(select 1 from paths p where p.discovery_id=d.discovery_id and p.attempted_at<=d.discovered_at) known_attribution
      from discoveries d
  ), overall_facts as (
    select d.opportunity_id,bool_or(d.is_primary) is_primary,bool_or(d.known_attribution) known_attribution,
      bool_or(coalesce(d.recommendation_eligible,false)) eligible,bool_or(d.recommendation_generated) generated,bool_or(d.updated_only) updated_only
      from discovery_facts d group by d.opportunity_id
  ), raw_labels as (
    select d.discovery_id,d.opportunity_id,d.is_primary,'institution'::text kind,d.institution label,200 max_length
      from discovery_facts d where d.institution is not null
    union all
    select d.discovery_id,d.opportunity_id,d.is_primary,'topic',t.label,120 from discovery_facts d cross join lateral unnest(d.topics) t(label)
  ), labels as (
    select l.discovery_id,l.opportunity_id,l.is_primary,l.kind,
      translate(btrim(l.label),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') label
      from raw_labels l where char_length(btrim(l.label)) between 1 and l.max_length
      and l.label!~'[[:cntrl:]]'
      and l.label!~*'([[:alnum:]_.%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}|mailto:|tel:|https?://|execute_sql|ignore[[:space:]]+((all|any)[[:space:]]+)?(previous|prior|system)|(drop|alter)[[:space:]]+(table|role|schema)|service_role)'
      and l.label!~'(\+?[0-9][0-9 ()/.-]{5,}[0-9])'
      and l.label!~*'(sb_secret_|sk-[[:alnum:]_-]{12,}|bearer[[:space:]]+[[:alnum:]_.~+/-]+|(api[_ -]?key|access[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=])'
  ), memberships as (
    select 'overall'::text kind,''::text key,d.opportunity_id,d.is_primary from discovery_facts d
    union all
    select 'query',p.query_id::text||':'||p.text_hash,p.opportunity_id,d.is_primary and p.check_id=d.primary_check_id
      from paths p join discovery_facts d on d.discovery_id=p.discovery_id where p.query_id is not null
    union all
    select 'source',p.source_registry_id::text,p.opportunity_id,d.is_primary and p.check_id=d.primary_check_id
      from paths p join discovery_facts d on d.discovery_id=p.discovery_id where p.source_registry_id is not null
    union all
    select l.kind,l.label,l.opportunity_id,l.is_primary from labels l
  ), cohorts as materialized (
    select m.kind,m.key,m.opportunity_id,bool_or(m.is_primary) is_primary from memberships m group by m.kind,m.key,m.opportunity_id
  ), opportunity_ids as (select distinct c.opportunity_id from cohorts c),
  review_bits as materialized (
    select o.opportunity_id,coalesce(r.state,'unreviewed') state,r.interest_rating,coalesce(r.feedback_excluded,false) excluded,
      coalesce(isfinite(a.submitted_at),false) or coalesce(a.status='submitted',false)
        or exists(select 1 from jsonb_array_elements(coalesce(a.status_history,'[]'::jsonb)) h where h->>'status'='submitted') submitted
      from opportunity_ids o left join public.opportunity_reviews r on r.user_id=actor and r.opportunity_id=o.opportunity_id
      left join public.applications a on a.user_id=actor and a.opportunity_id=o.opportunity_id
  ), feedback as materialized (
    select r.opportunity_id,r.excluded,r.submitted,not r.excluded and (r.interest_rating is not null or r.state<>'unreviewed') reviewed,
      case when r.excluded then null when r.interest_rating is not null then r.interest_rating
        when r.state='strong_interest' then 8 when r.state='interested' then 6 when r.state='not_interested' then 2 when r.submitted then 9 else null end score,
      case when r.excluded then 'excluded' when r.interest_rating is not null then 'explicit_rating'
        when r.state<>'unreviewed' then 'categorical_review' when r.submitted then 'confirmed_submission' else 'none' end origin
      from review_bits r
  ), metric_counts as (
    select c.kind,c.key,count(*) unique_encounters,count(*) filter(where c.is_primary) unique_discoveries,
      count(*) filter(where f.reviewed) reviewed,count(f.score) with_interest,round(avg(f.score),6) mean_interest,
      count(*) filter(where f.origin in('explicit_rating','categorical_review') and f.score>=8) explicit_high_interest,
      count(*) filter(where not f.excluded and f.submitted) confirmed_submissions,
      count(*) filter(where f.origin='explicit_rating') explicit_rating,count(*) filter(where f.origin='categorical_review') categorical_review,
      count(*) filter(where f.origin='confirmed_submission') submission_fallback
      from cohorts c join feedback f on f.opportunity_id=c.opportunity_id group by c.kind,c.key
  ), planned_queries as (
    select r.id run_id,q->>'query_id' query_id,q->>'text_hash' text_hash from owned_runs r
      cross join lateral jsonb_array_elements(coalesce(r.execution_expectations->'queries','[]'::jsonb)) q
      where q->>'query_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and q->>'text_hash'~'^[0-9a-f]{64}$'
  ), planned_sources as (
    select r.id run_id,s->>'registry_id' registry_id,coalesce(s->'mandatory'='true'::jsonb,false) or coalesce(s->'pinned'='true'::jsonb,false)
      or coalesce(s->'required'='true'::jsonb,false) required
      from owned_runs r cross join lateral jsonb_array_elements(coalesce(r.execution_expectations->'sources','[]'::jsonb)) s
      where s->>'registry_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), master_groups as (
    select 'overall'::text kind,''::text key
    union select c.kind,c.key from cohorts c
    union select 'query',q.query_id||':'||q.text_hash from planned_queries q
    union select 'source',s.registry_id from planned_sources s
    union select 'query',e.query_id::text||':'||e.text_hash from executions e where e.query_id is not null
    union select 'source',e.source_registry_id::text from executions e where e.source_registry_id is not null
  ), group_rows as (
    select g.kind,g.key,row_number() over(partition by g.kind order by g.key collate "C") priority,
      jsonb_build_object('unique_discoveries',coalesce(m.unique_discoveries,0),'unique_encounters',coalesce(m.unique_encounters,0),
        'reviewed',coalesce(m.reviewed,0),'with_interest',coalesce(m.with_interest,0),'mean_interest',m.mean_interest,
        'explicit_high_interest',coalesce(m.explicit_high_interest,0),'confirmed_submissions',coalesce(m.confirmed_submissions,0),
        'explicit_rating',coalesce(m.explicit_rating,0),'categorical_review',coalesce(m.categorical_review,0),'submission_fallback',coalesce(m.submission_fallback,0),
        'high_interest_rate',round(m.explicit_high_interest::numeric/nullif(m.reviewed,0),6))
      ||case g.kind when 'query' then jsonb_build_object('query_id',split_part(g.key,':',1),'text_hash',split_part(g.key,':',2),'executions',
          (select count(*) from executions e where e.query_id::text=split_part(g.key,':',1) and e.text_hash=split_part(g.key,':',2)))
        when 'source' then jsonb_build_object('registry_id',g.key,'executions',(select count(*) from executions e where e.source_registry_id::text=g.key))
        when 'topic' then jsonb_build_object('key',g.key) when 'institution' then jsonb_build_object('key',g.key) else '{}'::jsonb end entry
      from master_groups g left join metric_counts m on m.kind=g.kind and m.key=g.key
  ), omissions as (
    select jsonb_build_object('sources',count(*) filter(where g.kind='source' and g.priority>64),'queries',count(*) filter(where g.kind='query' and g.priority>64),
      'topics',count(*) filter(where g.kind='topic' and g.priority>64),'institutions',count(*) filter(where g.kind='institution' and g.priority>64)) counts,
      count(*) filter(where g.priority>64)>0 overflow from group_rows g
  ), logical_checks as (
    select e.run_id,e.kind,case when e.kind='query' then e.query_id::text||':'||e.text_hash else e.source_registry_id::text end key,
      max(e.attempted_at) filter(where e.status='complete') completed_at,max(e.attempted_at) filter(where e.status<>'complete') failed_at
      from executions e group by e.run_id,e.kind,case when e.kind='query' then e.query_id::text||':'||e.text_hash else e.source_registry_id::text end
  ), missing as (
    select count(*) value from (
      select distinct q.run_id,'query'::text kind,q.query_id||':'||q.text_hash key from planned_queries q
      union select distinct s.run_id,'source',s.registry_id from planned_sources s
    ) p where not exists(select 1 from logical_checks c where c.run_id=p.run_id and c.kind=p.kind and c.key=p.key and c.completed_at is not null
      and (c.failed_at is null or c.completed_at>=c.failed_at))
  ), run_state as (
    select coalesce(sum(r.backlog),0) backlog,coalesce(sum(r.omitted),0) omitted,coalesce(bool_or(r.overflow),false) overflow,
      count(*) filter(where r.status='failed') failed_runs,
      count(*) filter(where r.execution_report_status='unreported') unreported_runs,
      coalesce(bool_and(r.status<>'failed' and r.execution_report_status='complete'
        and not coalesce((r.execution_expectations->>'pending_queries')::boolean,true)
        and not coalesce((r.execution_expectations->>'late_prepared')::boolean,false)),false) declared_complete
      from owned_runs r
  ), coverage as (
    select count(*) executed_checks,count(*) filter(where e.status='complete') complete_checks,count(*) filter(where e.status='complete' and e.results_count=0) empty_successes,
      count(*) filter(where e.status='blocked') blocked_checks,count(*) filter(where e.status='failed') failed_checks,count(*) filter(where e.status='partial') partial_checks,
      count(*) filter(where e.status='paginated') paginated_checks,count(*) filter(where e.status='dynamic') dynamic_checks,
      (select count(*) from logical_checks c where c.completed_at is null or c.failed_at>c.completed_at) unresolved_checks,
      coalesce(bool_or(e.results_count>0),false) positive_results from executions e
  ), final_state as (
    select c.executed_checks,c.complete_checks,c.empty_successes,c.blocked_checks,c.failed_checks,c.partial_checks,c.paginated_checks,c.dynamic_checks,
      c.unresolved_checks,c.positive_results,m.value missing_checks,r.backlog,r.omitted,r.failed_runs,r.unreported_runs,r.overflow or o.overflow overflow,
      c.executed_checks=0 or not r.declared_complete or r.overflow or o.overflow or m.value>0 or c.unresolved_checks>0 or r.backlog+r.omitted>0 incomplete
      from coverage c cross join run_state r cross join missing m cross join omissions o
  ) select jsonb_build_object('metric_version','opportunity-search-quality-v1',
    'overall',(select g.entry from group_rows g where g.kind='overall'),
    'sources',coalesce((select jsonb_agg(g.entry order by g.key collate "C") from group_rows g where g.kind='source' and g.priority<=64),'[]'::jsonb),
    'queries',coalesce((select jsonb_agg(g.entry order by g.key collate "C") from group_rows g where g.kind='query' and g.priority<=64),'[]'::jsonb),
    'topics',coalesce((select jsonb_agg(g.entry order by g.key collate "C") from group_rows g where g.kind='topic' and g.priority<=64),'[]'::jsonb),
    'institutions',coalesce((select jsonb_agg(g.entry order by g.key collate "C") from group_rows g where g.kind='institution' and g.priority<=64),'[]'::jsonb),
    'coverage',jsonb_build_object('executed_checks',f.executed_checks,'complete_checks',f.complete_checks,'empty_successes',f.empty_successes,
      'blocked_checks',f.blocked_checks,'failed_checks',f.failed_checks,'partial_checks',f.partial_checks,'paginated_checks',f.paginated_checks,'dynamic_checks',f.dynamic_checks,
      'missing_checks',f.missing_checks,'unresolved_checks',f.unresolved_checks,'failed_runs',f.failed_runs,'unreported_runs',f.unreported_runs,
      'report_overflow',f.overflow,'incomplete',f.incomplete,
      'status',case when f.executed_checks=0 then 'unreported' when f.incomplete then 'incomplete'
        when f.positive_results or exists(select 1 from overall_facts) then 'complete_with_results' else 'complete_empty' end),
    'backlog',jsonb_build_object('retained',f.backlog,'omitted',f.omitted,'incomplete',f.backlog+f.omitted>0),
    'recommendations',jsonb_build_object('eligible',(select count(*) from overall_facts o where o.eligible),'generated',(select count(*) from overall_facts o where o.generated),
      'updated_only',(select count(*) from overall_facts o where o.updated_only),'delivery_status','unknown'),
    'groups_overlap',true,'omitted_groups',(select o.counts from omissions o),
    'attribution',jsonb_build_object('primary',(select count(*) from overall_facts o where o.is_primary),
      'secondary_only',(select count(*) from overall_facts o where not o.is_primary and o.known_attribution),'unknown',(select count(*) from overall_facts o where not o.known_attribution)))
    into result from final_state f;
  return result;
end;
$$;
revoke all on function public.read_opportunity_search_metrics(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_opportunity_search_metrics(uuid) to authenticated;
comment on function public.read_opportunity_search_metrics(uuid) is 'Owner-private observed quality metrics. Overlapping groups are not additive and generated recommendations never prove delivery.';
commit;
