-- Installed in phd-workflow on 2026-10-28. No catalogue backfill is performed.
-- Migrations: 20261028210636 (merge/protocol), 20261028210937 (audit FK index).
-- Prerequisite: installed opportunity-search bootstrap v1 / normalization-3.
begin;

create table private.opportunity_search_merge_state (
  opportunity_id uuid primary key references public.opportunities(id) on delete restrict,
  fields jsonb not null check (jsonb_typeof(fields)='object')
);
create table private.opportunity_search_merge_audit (
  sequence bigint generated always as identity primary key,
  run_id uuid not null,
  item_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  before_identities jsonb not null,
  after_identities jsonb not null,
  decisions jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz,
  unique(run_id,item_id)
);
create index opportunity_search_merge_audit_run on private.opportunity_search_merge_audit(run_id,sequence desc);
create index opportunity_search_merge_audit_opportunity on private.opportunity_search_merge_audit(opportunity_id);
alter table private.opportunity_search_merge_state enable row level security;
alter table private.opportunity_search_merge_audit enable row level security;
revoke all on private.opportunity_search_merge_state, private.opportunity_search_merge_audit from public,anon,authenticated;

create or replace function private.opportunity_merge_present(v jsonb) returns boolean
language sql immutable set search_path='' as $$
  select v is not null and v not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)
$$;

create or replace function private.opportunity_merge_key(v text) returns text
language sql immutable set search_path='' as $$
  select regexp_replace(lower(btrim(coalesce(v,''))), '[[:space:]_-]+',' ','g')
$$;

create or replace function private.opportunity_merge_pointer(v text) returns text
language sql immutable set search_path='' as $$ select replace(replace(v,'~','~0'),'/','~1') $$;

-- Evidence URLs are not vacancy identifiers: graduate-school and listing URLs count.
create or replace function private.opportunity_merge_url(v text) returns text
language plpgsql immutable set search_path='' as $$
declare p text[]; q text;
begin
  p:=regexp_match(btrim(v),'^https?://([^/?#]+)([^?#]*)(?:[?]([^#]*))?(?:#.*)?$','i');
  if p is null then return lower(btrim(v)); end if;
  select string_agg(x,'&' order by x) into q from unnest(string_to_array(p[3],'&')) x
    where x<>'' and lower(split_part(x,'=',1))!~'^(utm_.*|gclid|fbclid|msclkid)$';
  return regexp_replace(lower(p[1]),':(80|443)$','')||regexp_replace(p[2],'/+$','')||coalesce('?'||q,'');
end $$;

create or replace function private.opportunity_merge_precise_time(v text) returns timestamptz
language plpgsql stable set search_path='' as $$
begin
 if v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return null; end if;
 return v::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;

-- Preserve the previous schema as an immutable compatibility input description.
CREATE OR REPLACE FUNCTION private.opportunity_merge_input_schema_v3()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select E'{"type":"object","additionalProperties":false,"required":["opportunity_key","title","last_checked_at","sources"],"properties":{"opportunity_key":{"type":"string","minLength":1,"maxLength":2000},"title":{"type":"string","minLength":1,"maxLength":2000},"vacancy_id":{"type":["string","null"]},"institution":{"type":["string","null"]},"unit":{"type":["string","null"]},"city":{"type":["string","null"]},"country":{"type":["string","null"]},"position_type":{"type":["string","null"]},"availability":{"type":["string","null"]},"deadline_original_text":{"type":["string","null"]},"research_summary":{"type":["string","null"]},"duration_details":{"type":["string","null"]},"particularly_suitable_reason":{"type":["string","null"]},"source_context":{"type":["string","null"]},"verification_level":{"type":"string"},"official_url":{"type":["string","null"],"pattern":"^https?://[^\\\\s]+$"},"source_url":{"type":["string","null"],"pattern":"^https?://[^\\\\s]+$"},"application_url":{"type":["string","null"],"pattern":"^(https?://[^\\\\s]+|mailto:[^\\\\s@?]+@[^\\\\s@?]+(?:\\\\?[^\\\\s]*)?)$"},"deadline":{"type":["string","null"],"format":"date"},"start_date":{"type":["string","null"],"format":"date"},"deadline_time_local":{"type":["string","null"],"pattern":"^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"},"deadline_timezone":{"type":["string","null"],"format":"opportunity-timezone"},"topics":{"type":"array","items":{"type":"string"}},"special_features":{"type":"array","items":{"type":"string"}},"open_questions":{"type":"array","items":{"type":"string"}},"supervisors":{"type":"array","items":{"type":"object"}},"contacts":{"type":"array","items":{"type":"object"}},"requirements":{"anyOf":[{"type":"array","items":{"type":["string","object"]}},{"type":"object","minProperties":1,"properties":{"required":{"type":"array","items":{"type":["string","object"]}},"preferred":{"type":"array","items":{"type":["string","object"]}},"advantageous":{"type":"array","items":{"type":["string","object"]}},"conditional":{"type":"array","items":{"type":["string","object"]}},"optional":{"type":"array","items":{"type":["string","object"]}},"university_admission":{"type":"array","items":{"type":["string","object"]}}},"additionalProperties":{"type":["string","array","object","null"]}}]},"required_documents":{"anyOf":[{"type":"array","items":{"type":["string","object"]}},{"type":"object","minProperties":1,"properties":{"required":{"type":"array","items":{"type":["string","object"]}},"preferred":{"type":"array","items":{"type":["string","object"]}},"advantageous":{"type":"array","items":{"type":["string","object"]}},"conditional":{"type":"array","items":{"type":["string","object"]}},"optional":{"type":"array","items":{"type":["string","object"]}},"university_admission":{"type":"array","items":{"type":["string","object"]}}},"additionalProperties":{"type":["string","array","object","null"]}}]},"supervisor_research_focus":{"type":"object"},"supervisor_top_papers":{"type":["array","object"]},"salary":{"type":"object"},"supervisor_reputation":{"type":"object"},"hardware_software_balance":{"type":"object"},"personal_fit":{"type":"object","required":["score","scale_min","scale_max","summary"],"properties":{"score":{"type":"number","minimum":0,"maximum":10},"scale_min":{"type":"number","const":0},"scale_max":{"type":"number","const":10},"summary":{"type":"string","minLength":1,"pattern":"\\\\S"},"subscores":{"type":"object","additionalProperties":{"type":"number","minimum":0,"maximum":10}}}},"rd_career_potential":{"type":"object","required":["score","scale_min","scale_max","summary"],"properties":{"score":{"type":"number","minimum":0,"maximum":10},"scale_min":{"type":"number","const":0},"scale_max":{"type":"number","const":10},"summary":{"type":"string","minLength":1,"pattern":"\\\\S"},"subscores":{"type":"object","additionalProperties":{"type":"number","minimum":0,"maximum":10}}}},"research_career_potential":{"type":"object","required":["score","scale_min","scale_max","summary"],"properties":{"score":{"type":"number","minimum":0,"maximum":10},"scale_min":{"type":"number","const":0},"scale_max":{"type":"number","const":10},"summary":{"type":"string","minLength":1,"pattern":"\\\\S"},"subscores":{"type":"object","additionalProperties":{"type":"number","minimum":0,"maximum":10}}}},"particularly_suitable":{"type":["boolean","null"]},"data":{"type":"object","properties":{"research_methods":{"type":"array","items":{"type":"string"}},"teaching_load":{"type":["string","object","null"],"properties":{"status":{"type":"string"},"details":{"type":"string"}}},"url_roles":{"type":"object","additionalProperties":false,"properties":{"official_url":{"type":"string","enum":["vacancy","listing","application_portal","context","unknown"]},"source_url":{"type":"string","enum":["vacancy","listing","application_portal","context","unknown"]},"application_url":{"type":"string","enum":["vacancy","listing","application_portal","context","unknown"]}}}}},"last_checked_at":{"type":"string","format":"date-time"},"sources":{"type":"array","minItems":1,"items":{"type":"object","required":["url","kind","checked_at","supports"],"properties":{"url":{"type":"string","pattern":"^https?://[^\\\\s]+$"},"kind":{"type":"string","enum":["official","official_listing","institution","graduate_school","discovery","unknown"]},"checked_at":{"anyOf":[{"type":"string","format":"date-time"},{"type":"string","format":"date"}]},"supports":{"type":"array","items":{"type":"string"}},"unmapped_supports":{"type":"array","items":{"type":"string"}},"legacy":{"type":"object"}}}}}}'::jsonb
$function$;

create or replace function private.opportunity_merge_set(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(value order by key),'[]') from (
    select private.opportunity_merge_key(value#>>'{}') key,min(value#>>'{}')::text representative,
      to_jsonb(min(btrim(value#>>'{}'))) value
    from jsonb_array_elements(case jsonb_typeof(v) when 'array' then v when 'null' then '[]' else jsonb_build_array(v) end)
    where jsonb_typeof(value)='string' and btrim(value#>>'{}')<>'' group by 1
  ) s
$$;

-- Compatibility helper: recursive objects only; arrays are atomic here.
-- Submission never uses this helper as a universal list-union policy.
create or replace function private.opportunity_search_merge_value(p_old jsonb,p_new jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb:=p_old; k text; v jsonb;
begin
  if not private.opportunity_merge_present(p_new) then return coalesce(p_old,'null'); end if;
  if not private.opportunity_merge_present(p_old) then return p_new; end if;
  if jsonb_typeof(p_old)='object' and jsonb_typeof(p_new)='object' then
    for k,v in select * from jsonb_each(p_new) order by key loop
      r:=jsonb_set(r,array[k],private.opportunity_search_merge_value(p_old->k,v));
    end loop;
    return r;
  end if;
  if jsonb_typeof(p_old)<>jsonb_typeof(p_new) then return p_old; end if;
  return p_new;
end $$;

create or replace function private.opportunity_merge_stage(v text) returns text
language sql immutable set search_path='' as $$
 select case private.opportunity_merge_key(v)
   when 'university admission' then 'doctoral_admission'
   when 'doctoral admission after selection' then 'doctoral_admission'
   when 'post hire admission' then 'doctoral_admission'
   else coalesce(nullif(btrim(v),''),'unspecified') end
$$;

-- Turn grouped checklists into entities without guessing that an unlabelled item is required.
-- Unknown categories, conditions, stages and all extra object properties survive.
create or replace function private.opportunity_merge_checklist(v jsonb, p_status text default 'unspecified', p_stage text default 'unspecified', p_group text default null) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb:='[]'; e jsonb; k text; x jsonb; status text; stage text;
begin
 if not private.opportunity_merge_present(v) then return r; end if;
 if jsonb_typeof(v)='array' then
   for e in select value from jsonb_array_elements(v) loop
     r:=r||private.opportunity_merge_checklist(e,p_status,p_stage,p_group);
   end loop;
 elsif jsonb_typeof(v)='object' and not (v ?| array['text','requirement','document','name','title','item','label']) then
   for k,e in select * from jsonb_each(v) order by key loop
     status:=case lower(k) when 'mandatory' then 'required' when 'essential' then 'required'
       when 'university_admission' then 'required' when 'university_admission_documents' then 'required'
       when 'required' then 'required' when 'optional' then 'optional' when 'conditional' then 'conditional'
       when 'preferred' then 'preferred' when 'advantageous' then 'advantageous' else p_status end;
     stage:=case when lower(k) in ('university_admission','university_admission_documents','doctoral_admission','doctoral_admission_after_selection')
       then 'doctoral_admission' else p_stage end;
     r:=r||private.opportunity_merge_checklist(e,status,stage,k);
   end loop;
 else
   x:=case when jsonb_typeof(v)='object' then v else jsonb_build_object('text',case when jsonb_typeof(v)='string' then v#>>'{}' else v::text end,'legacy_value',v) end;
   x:=x||jsonb_build_object('text',coalesce(x->>'text',x->>'requirement',x->>'document',x->>'name',x->>'title',x->>'item',x->>'label',v::text),
     'status',coalesce(x->>'status',case when x->'required'='true' then 'required' when x->'required'='false' then 'optional' end,p_status),
     'stage',private.opportunity_merge_stage(coalesce(x->>'stage',p_stage)));
   if p_group is not null and not x?'legacy_group' then x:=x||jsonb_build_object('legacy_group',p_group); end if;
   r:=jsonb_build_array(x);
 end if;
 return r;
end $$;

create or replace function private.opportunity_merge_entity_key(p_field text,v jsonb) returns text
language sql immutable set search_path='' as $$
 select case
 when p_field in ('contacts','supervisors') then coalesce(
   'id:'||nullif(v->>'entity_id',''), 'orcid:'||nullif(lower(v->>'orcid'),''),
   'email:'||nullif(lower(btrim(v->>'email')),''),
   'name:'||nullif(private.opportunity_merge_key(v->>'name'),'')||':'||private.opportunity_merge_key(v->>'institution'),
   'legacy:'||md5(v::text))
 when p_field in ('requirements','required_documents') then
   coalesce('id:'||nullif(v->>'id',''), 'text:'||private.opportunity_merge_key(v->>'text'))||':stage:'||private.opportunity_merge_stage(v->>'stage')
 when p_field='supervisor_top_papers' then
   coalesce('id:'||nullif(v->>'entity_id',''),'doi:'||nullif(regexp_replace(lower(v->>'doi'),'^https?://(dx[.])?doi[.]org/',''),''),
     'url:'||nullif(private.opportunity_merge_url(v->>'url'),''),
     'title:'||nullif(private.opportunity_merge_key(v->>'title'),''), 'legacy:'||md5(v::text))
 else 'value:'||md5(v::text) end
$$;

create function private.opportunity_merge_paper_match(a jsonb,b jsonb) returns boolean
language sql immutable set search_path='' as $$
 select (a->>'entity_id'=b->>'entity_id') or
 (nullif(a->>'doi','') is not null and regexp_replace(lower(a->>'doi'),'^https?://(dx[.])?doi[.]org/','')=regexp_replace(lower(b->>'doi'),'^https?://(dx[.])?doi[.]org/','')) or
 (not (nullif(a->>'doi','') is not null and nullif(b->>'doi','') is not null and regexp_replace(lower(a->>'doi'),'^https?://(dx[.])?doi[.]org/','')<>regexp_replace(lower(b->>'doi'),'^https?://(dx[.])?doi[.]org/',''))
   and ((nullif(a->>'url','') is not null and private.opportunity_merge_url(a->>'url')=private.opportunity_merge_url(b->>'url'))
     or (nullif(private.opportunity_merge_key(a->>'title'),'') is not null and private.opportunity_merge_key(a->>'title')=private.opportunity_merge_key(b->>'title')
       and (a->>'year' is null or b->>'year' is null or a->>'year'=b->>'year'))))
$$;

create or replace function private.opportunity_merge_person_match(a jsonb,b jsonb) returns boolean
language sql immutable set search_path='' as $$
 select not (nullif(a->>'orcid','') is not null and nullif(b->>'orcid','') is not null and lower(a->>'orcid')<>lower(b->>'orcid')) and (
 (nullif(a->>'entity_id','') is not null and a->>'entity_id'=b->>'entity_id') or
 (nullif(a->>'orcid','') is not null and lower(a->>'orcid')=lower(b->>'orcid')) or
 (nullif(a->>'email','') is not null and lower(btrim(a->>'email'))=lower(btrim(b->>'email'))) or
 (nullif(private.opportunity_merge_key(a->>'name'),'') is not null
   and private.opportunity_merge_key(a->>'name')=private.opportunity_merge_key(b->>'name')
   and (nullif(a->>'institution','') is null or nullif(b->>'institution','') is null or private.opportunity_merge_key(a->>'institution')=private.opportunity_merge_key(b->>'institution'))
   and not (nullif(a->>'email','') is not null and nullif(b->>'email','') is not null and lower(btrim(a->>'email'))<>lower(btrim(b->>'email')))
   and not (nullif(a->>'orcid','') is not null and nullif(b->>'orcid','') is not null and lower(a->>'orcid')<>lower(b->>'orcid'))))
$$;

create or replace function private.opportunity_merge_entities(p_field text,v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare entries jsonb:='[]'; r jsonb:='[]'; e jsonb; x jsonb; old jsonb; k text; matches integer[]; i integer; roles jsonb;
begin
 if not private.opportunity_merge_present(v) then return '[]'; end if;
 if p_field in ('requirements','required_documents') then entries:=private.opportunity_merge_checklist(v);
 elsif jsonb_typeof(v)='object' and p_field='supervisor_top_papers' then
   if v ?| array['title','doi','url','papers'] then entries:=jsonb_build_array(v);
   else for k,e in select * from jsonb_each(v) order by key loop entries:=entries||jsonb_build_array(jsonb_build_object('supervisor',k,'papers',e)); end loop; end if;
 elsif jsonb_typeof(v)='object' and not (v ?| array['name','email','entity_id','role','orcid']) then
   for k,e in select * from jsonb_each(v) order by key loop entries:=entries||jsonb_build_array(
     case when jsonb_typeof(e)='object' then e||jsonb_build_object('name',k) else jsonb_build_object('name',k,'legacy_value',e) end); end loop;
 else entries:=case when jsonb_typeof(v)='array' then v else jsonb_build_array(v) end; end if;
 -- Flatten paper groups; group metadata accompanies each publication.
 if p_field='supervisor_top_papers' then
   for e in select value from jsonb_array_elements(entries) loop
     if jsonb_typeof(e->'papers')='array' then
       for x in select value from jsonb_array_elements(e->'papers') loop r:=r||jsonb_build_array((e-'papers')||case when jsonb_typeof(x)='object' then x else jsonb_build_object('title',x,'legacy_value',x) end); end loop;
     else r:=r||jsonb_build_array(e); end if;
   end loop;
   entries:=r; r:='[]';
 end if;
 -- A stable ordering makes normalization independent of incoming array order.
 for e in select value from jsonb_array_elements(entries) order by value::text loop
   x:=case when jsonb_typeof(e)='object' then e else jsonb_build_object('name',case when jsonb_typeof(e)='string' then e#>>'{}' else e::text end,'legacy_value',e) end;
   if p_field in ('contacts','supervisors') then
     if x?'email' then x:=x||jsonb_build_object('email',lower(btrim(x->>'email'))); end if;
     roles:=private.opportunity_merge_set(coalesce(x->'roles','[]')||case when nullif(x->>'role','') is not null then jsonb_build_array(x->>'role') else '[]' end);
     if roles<>'[]' then x:=x||jsonb_build_object('roles',roles); end if;
   elsif p_field='supervisor_top_papers' and (x?'supervisor' or x?'supervisors') then
     x:=x||jsonb_build_object('supervisors',private.opportunity_merge_set(coalesce(x->'supervisors','[]')||case when x?'supervisor' then jsonb_build_array(x->>'supervisor') else '[]' end));
   end if;
   if p_field in ('contacts','supervisors','supervisor_top_papers') and not x?'entity_id' then
     x:=x||jsonb_build_object('entity_id','generated:'||md5(private.opportunity_merge_entity_key(p_field,x)));
   end if;
   select array_agg(n::integer) into matches from jsonb_array_elements(r) with ordinality t(a,n)
     where case when p_field in ('contacts','supervisors') then private.opportunity_merge_person_match(a,x)
       when p_field='supervisor_top_papers' then private.opportunity_merge_paper_match(a,x)
       else private.opportunity_merge_entity_key(p_field,a)=private.opportunity_merge_entity_key(p_field,x) end;
   if cardinality(matches)=1 then
     i:=matches[1]-1; old:=r->i;
     if old?'entity_id' and x->>'entity_id' like 'generated:%' then x:=jsonb_set(x,'{entity_id}',old->'entity_id'); end if;
     x:=private.opportunity_search_merge_value(old,x);
     if p_field in ('contacts','supervisors') then x:=x||jsonb_build_object('roles',private.opportunity_merge_set(coalesce(old->'roles','[]')||coalesce(x->'roles','[]'))); end if;
     if p_field='supervisor_top_papers' and (old?'supervisors' or x?'supervisors') then x:=x||jsonb_build_object('supervisors',private.opportunity_merge_set(coalesce(old->'supervisors','[]')||coalesce(x->'supervisors','[]'))); end if;
     -- Preserve every duplicate variant, including differing names/roles and unknown keys.
     select coalesce(jsonb_agg(a order by a),'[]') into roles from (select distinct a from jsonb_array_elements(
       coalesce(old->'legacy_variants','[]')||jsonb_build_array(old-'legacy_variants',x-'legacy_variants')) t(a)) entries;
     if old-'legacy_variants'<>x-'legacy_variants' then x:=x||jsonb_build_object('legacy_variants',roles); end if;
     r:=jsonb_set(r,array[i::text],x);
   else r:=r||jsonb_build_array(x); end if;
 end loop;
 select coalesce(jsonb_agg(a order by private.opportunity_merge_entity_key(p_field,a),a),'[]') into r from jsonb_array_elements(r) t(a);
 return r;
end $$;

create or replace function private.opportunity_merge_sources(v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb:='[]'; s jsonb; old jsonb; idx integer; stamp text; signature text; old_signature text; observations jsonb;
begin
 for s in select private.opportunity_search_normalize_source(a) from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else jsonb_build_array(v) end) t(a) order by a loop
   if jsonb_typeof(s)<>'object' then s:=jsonb_build_object('kind','unknown','supports','[]','legacy_value',s); end if;
   stamp:=coalesce((private.opportunity_merge_precise_time(s->>'checked_at') at time zone 'UTC')::text,s->>'checked_at');
   signature:=coalesce(private.opportunity_merge_url(s->>'url'),'legacy:'||md5(s::text))||':'||coalesce(stamp,'unknown')||':'||coalesce(s->>'kind','unknown');
   idx:=null;
   for old,idx in select a,(n-1)::integer from jsonb_array_elements(r) with ordinality t(a,n) loop
     old_signature:=coalesce(private.opportunity_merge_url(old->>'url'),'legacy:'||md5(old::text))||':'||coalesce(
       coalesce((private.opportunity_merge_precise_time(old->>'checked_at') at time zone 'UTC')::text,old->>'checked_at'),'unknown')||':'||coalesce(old->>'kind','unknown');
     exit when old_signature=signature;
     idx:=null;
   end loop;
   if idx is null then r:=r||jsonb_build_array(s);
   else
     observations:=coalesce(old->'legacy_variants','[]');
     if old-'legacy_variants'<>s-'legacy_variants' then
       select jsonb_agg(x order by x) into observations from (select distinct x from jsonb_array_elements(observations||coalesce(s->'legacy_variants','[]')||jsonb_build_array(old-'legacy_variants',s-'legacy_variants')) t(x)) entries;
     end if;
     s:=private.opportunity_search_merge_value(old,s)||jsonb_build_object('supports',private.opportunity_merge_set(coalesce(old->'supports','[]')||coalesce(s->'supports','[]')));
     if old?'unmapped_supports' or s?'unmapped_supports' then s:=s||jsonb_build_object('unmapped_supports',private.opportunity_merge_set(coalesce(old->'unmapped_supports','[]')||coalesce(s->'unmapped_supports','[]'))); end if;
     if observations<>'[]' then s:=s||jsonb_build_object('legacy_variants',observations); end if;
     r:=jsonb_set(r,array[idx::text],s);
   end if;
 end loop;
 return (select coalesce(jsonb_agg(a order by a),'[]') from jsonb_array_elements(r) t(a));
end $$;

create or replace function private.opportunity_merge_canonical(p_field text,v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; legacy jsonb:='{}'; k text; raw jsonb; normalized text;
begin
 if p_field in ('contacts','supervisors','requirements','required_documents','supervisor_top_papers') then return private.opportunity_merge_entities(p_field,v); end if;
 if p_field in ('topics','special_features','open_questions','research_methods','roles') then return private.opportunity_merge_set(v); end if;
 if p_field='sources' then
   return private.opportunity_merge_sources(v);
 end if;
 if p_field='salary' and jsonb_typeof(v)<>'object' and private.opportunity_merge_present(v) then return jsonb_build_object('details',v,'legacy_value',v); end if;
 if p_field='salary' and jsonb_typeof(v)='object' then
   r:=v;
   foreach k in array array['amount','min','max'] loop
     raw:=r->k;
     if raw is null or raw='null' or jsonb_typeof(raw)='number' then continue; end if;
     legacy:=legacy||jsonb_build_object(k,raw);
     if jsonb_typeof(raw)='string' and raw#>>'{}'~'^[0-9]+([.][0-9]+)?$' then r:=jsonb_set(r,array[k],to_jsonb((raw#>>'{}')::numeric)); else r:=r-k; end if;
   end loop;
   if r?'currency' and jsonb_typeof(r->'currency')='string' then
     normalized:=upper(btrim(r->>'currency'));
     if normalized='€' then normalized:='EUR'; elsif normalized='£' then normalized:='GBP'; end if;
     if normalized<>r->>'currency' then legacy:=legacy||jsonb_build_object('currency',r->'currency'); end if;
     if normalized~'^[A-Z]{3}$' then r:=jsonb_set(r,'{currency}',to_jsonb(normalized));
     else legacy:=legacy||jsonb_build_object('currency',r->'currency'); r:=r-'currency'; end if;
   end if;
   if r?'period' and jsonb_typeof(r->'period')='string' then
     normalized:=case lower(btrim(r->>'period')) when 'monthly' then 'month' when 'annually' then 'year' when 'annual' then 'year' when 'yearly' then 'year'
       when 'per annum' then 'year' when 'hourly' then 'hour' when 'weekly' then 'week' else lower(btrim(r->>'period')) end;
     if normalized<>r->>'period' then legacy:=legacy||jsonb_build_object('period',r->'period'); end if;
     r:=jsonb_set(r,'{period}',to_jsonb(normalized));
   end if;
   if legacy<>'{}' then r:=r||jsonb_build_object('legacy_fields',coalesce(r->'legacy_fields','{}')||legacy); end if;
   return r;
 end if;
 return v;
end $$;

-- The allowlist is explicit. Unknown arrays inside extension objects are atomic.
create or replace function private.opportunity_merge_policy(p_path text) returns text
language sql immutable set search_path='' as $$
 select case
 when p_path in ('/personal_fit','/rd_career_potential','/research_career_potential','/supervisor_reputation','/hardware_software_balance','/data/living_standard') then 'assessment'
 when p_path='/salary' then 'salary'
 when p_path in ('/contacts','/supervisors','/requirements','/required_documents','/supervisor_top_papers') then 'entities'
 when p_path in ('/topics','/special_features','/open_questions','/data/research_methods') or p_path like '%/roles'
   or p_path like '/supervisor_top_papers/%/supervisors' then 'set'
 when p_path='/salary/@quote' then 'assessment'
 when p_path='/opportunity_key' or p_path like '%/entity_id' then 'identity'
 when p_path='/last_checked_at' then 'clock'
 else 'recursive' end
$$;

create or replace function private.opportunity_search_normalize_record(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb:=p; k text; v jsonb; d jsonb; alias text; target text; aliases text[]; candidates jsonb;
begin
 for alias,target in select * from (values ('contact','contacts'),('supervisor','supervisors'),('documents','required_documents'),
   ('application_documents','required_documents'),('salary_text','salary'),('university','institution')) a(x,y) loop
   if p?alias and not p?target then r:=r||jsonb_build_object(target,p->alias); end if;
 end loop;
 for k,v in select * from jsonb_each(r) loop
   if k in ('contacts','supervisors','requirements','required_documents','supervisor_top_papers','sources','salary','topics','special_features','open_questions') then
     r:=jsonb_set(r,array[k],private.opportunity_merge_canonical(k,v));
   end if;
 end loop;
 if jsonb_typeof(r->'data')='object' then
   d:=r->'data';
   foreach target in array array['research_methods','teaching_load'] loop
     aliases:=case target when 'research_methods' then array['methods','methodology','advertised_methods']
       else array['teaching','teaching_text','teaching_and_departmental_duties'] end;
     select coalesce(jsonb_agg(distinct case when target='research_methods' then private.opportunity_merge_set(d->a) else d->a end),'[]') into candidates from unnest(aliases) a where private.opportunity_merge_present(d->a);
     if not d?target and jsonb_array_length(candidates)=1 then d:=d||jsonb_build_object(target,candidates->0); end if;
   end loop;
   if d?'research_methods' then d:=jsonb_set(d,'{research_methods}',private.opportunity_merge_set(d->'research_methods')); end if;
   r:=jsonb_set(r,'{data}',d);
 end if;
 if p->>'deadline_timezone' in ('EEST','AoE') then
   r:=r||jsonb_build_object('deadline_timezone',case p->>'deadline_timezone' when 'EEST' then 'UTC+03:00' else 'UTC-12:00' end);
 end if;
 if r->>'deadline_time_local'~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   r:=jsonb_set(r,'{deadline_time_local}',to_jsonb((r->>'deadline_time_local')||':00'));
 end if;
 return r;
end $$;

create function private.opportunity_merge_alias_conflicts(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare d jsonb:=p->'data'; target text; aliases text[]; values_seen jsonb; r jsonb:='[]';
begin
 if jsonb_typeof(d) is distinct from 'object' then return r; end if;
 foreach target in array array['research_methods','teaching_load'] loop
   aliases:=case target when 'research_methods' then array['methods','methodology','advertised_methods','research_methods']
     else array['teaching','teaching_text','teaching_and_departmental_duties','teaching_load'] end;
   select coalesce(jsonb_agg(distinct case when target='research_methods' then private.opportunity_merge_set(d->a) else d->a end),'[]') into values_seen from unnest(aliases) a where private.opportunity_merge_present(d->a);
   if jsonb_array_length(values_seen)>1 then r:=r||jsonb_build_array(jsonb_build_object('path','/data/'||target,'policy','normalization','status','conflicting',
     'reason','ambiguous_legacy_aliases','before',d->target,'after',d->target,'proposed',values_seen)); end if;
 end loop;
 return r;
end $$;

create or replace function private.opportunity_merge_evidence(p_sources jsonb,p_path text) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(s order by s),'[]') from (
   select distinct private.opportunity_search_normalize_source(a) s from jsonb_array_elements(coalesce(p_sources,'[]')) t(a)
 ) n where exists(select 1 from jsonb_array_elements_text(s->'supports') t(f)
   where p_path='/'||f or left(p_path,length(f)+2)='/'||f||'/' or p_path=f or left(p_path,length(f)+1)=f||'/')
$$;

-- Resolve stable entity segments as well as ordinary escaped object keys.
create function private.opportunity_merge_value_at(p_value jsonb,p_suffix text,p_field text) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb:=p_value; part text; candidates jsonb;
begin
 foreach part in array string_to_array(p_suffix,'/') loop
   part:=replace(replace(part,'~1','/'),'~0','~');
   if part='@quote' and p_field='salary' and jsonb_typeof(r)='object' then
     select coalesce(jsonb_object_agg(key,value),'{}') into r from jsonb_each(r) where key=any(array['amount','min','max','currency','period','gross','model']);
   elsif left(part,1)='@' and jsonb_typeof(r)='array' then
     select jsonb_agg(a) into candidates from jsonb_array_elements(r) t(a) where
       case when jsonb_typeof(a)='string' then private.opportunity_merge_key(a#>>'{}')=substring(part from 2)
       else private.opportunity_merge_entity_key(p_field,a)=substring(part from 2) end;
     if jsonb_array_length(candidates)=1 then r:=candidates->0; else return null; end if;
   elsif jsonb_typeof(r)='object' then r:=r->part;
   else return null; end if;
 end loop;
 return r;
end $$;

create or replace function private.opportunity_merge_evidence_signature(v jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x order by x),'[]') from (
   select distinct jsonb_build_array(private.opportunity_merge_url(s->>'url'),
     private.opportunity_merge_precise_time(s->>'checked_at')) x from jsonb_array_elements(coalesce(v,'[]')) t(s)
   where private.opportunity_merge_precise_time(s->>'checked_at') is not null and private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school')
 ) n
$$;

create function private.opportunity_merge_same_evidence(p_old jsonb,p_new jsonb) returns boolean
language sql stable set search_path='' as $$
 select private.opportunity_merge_evidence_signature(p_new)<>'[]' and
   private.opportunity_merge_evidence_signature(p_old) @> private.opportunity_merge_evidence_signature(p_new)
$$;

-- Return a decision, never update provenance here. Equal clocks do not imply authority.
create or replace function private.opportunity_merge_authorize(p_old jsonb,p_new jsonb,p_old_evidence jsonb,p_new_evidence jsonb,p_correction jsonb) returns text
language plpgsql stable set search_path='' as $$
declare ot timestamptz; nt timestamptz; official_old boolean; shared boolean; correction boolean;
begin
 if p_correction is not null and p_correction->'expected' is distinct from coalesce(p_old,'null') then return 'conflicting:correction_precondition_failed'; end if;
 if p_old is not distinct from p_new then return 'unchanged'; end if;
 correction:=p_correction->'expected' is not distinct from coalesce(p_old,'null') and length(btrim(coalesce(p_correction->>'reason','')))>0;
 select max(private.opportunity_merge_precise_time(s->>'checked_at')) into nt from jsonb_array_elements(coalesce(p_new_evidence,'[]')) t(s)
   where private.opportunity_merge_precise_time(s->>'checked_at') is not null and private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school');
 if nt is null then return 'rejected:missing_precise_official_evidence'; end if;
 if not private.opportunity_merge_present(p_new) and not correction then return 'unchanged:empty_partial'; end if;
 if not private.opportunity_merge_present(p_old) then return 'accepted:verified_addition'; end if;
 select max(private.opportunity_search_evidence_time(s)),coalesce(bool_or(private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school')),false)
   into ot,official_old from jsonb_array_elements(coalesce(p_old_evidence,'[]')) t(s);
 select exists(select 1 from jsonb_array_elements(coalesce(p_new_evidence,'[]')) n, jsonb_array_elements(coalesce(p_old_evidence,'[]')) o
   where private.opportunity_merge_url(n->>'url')=private.opportunity_merge_url(o->>'url')
   and private.opportunity_search_source_kind(n) in ('official','official_listing','institution','graduate_school')
   and private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school')) into shared;
 if nt<ot then return 'rejected:stale_evidence'; end if;
 if correction and nt=ot and private.opportunity_merge_same_evidence(p_old_evidence,p_new_evidence)
   then return 'accepted:same_evidence_correction'; end if;
 if nt=ot then return 'conflicting:equal_time_requires_compare_and_set_correction'; end if;
 if official_old and not shared and not correction then return 'conflicting:different_official_authority'; end if;
 if jsonb_typeof(p_old)<>jsonb_typeof(p_new) and not correction then return 'conflicting:type_change_requires_correction'; end if;
 return 'accepted:newer_official_evidence';
end $$;

create function private.opportunity_merge_can_revalidate(p_old jsonb,p_new jsonb) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(coalesce(p_new,'[]')) n
   where private.opportunity_search_source_kind(n) in ('official','official_listing','institution','graduate_school')
   and private.opportunity_merge_precise_time(n->>'checked_at')>coalesce((select max(private.opportunity_search_evidence_time(o)) from jsonb_array_elements(coalesce(p_old,'[]')) o),'-infinity'::timestamptz)
   and (not exists(select 1 from jsonb_array_elements(coalesce(p_old,'[]')) o where private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school'))
     or exists(select 1 from jsonb_array_elements(coalesce(p_old,'[]')) o where private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school')
       and private.opportunity_merge_url(o->>'url')=private.opportunity_merge_url(n->>'url'))))
$$;

-- Every state entry binds one effective value to exactly its effective evidence.
-- Rejected attempts exist only in audit/receipts, never in this state.
create or replace function private.opportunity_merge_node(p_path text,p_old jsonb,p_new jsonb,p_state jsonb,p_old_sources jsonb,p_new_sources jsonb,p_control jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare policy text:=private.opportunity_merge_policy(p_path); r jsonb:=p_old; state jsonb:=p_state; decisions jsonb:='[]';
  k text; v jsonb; child jsonb; path text; old_e jsonb; new_e jsonb; correction jsonb; verdict text; entry jsonb;
  old_entry jsonb; idx integer; matches integer[]; canonical_field text:=split_part(p_path,'/',2); added jsonb;
  quote_keys text[]:=array['amount','min','max','currency','period','gross','model']; old_quote jsonb; new_quote jsonb;
  ancestor record; bound boolean:=false; effective_absence boolean:=false; old_t timestamptz; new_t timestamptz;
begin
 select c into correction from jsonb_array_elements(coalesce(p_control->'corrections','[]')) t(c) where c->>'path'=p_path;
 if p_new is null then return jsonb_build_object('value',coalesce(p_old,'null'),'state',state,'decisions',decisions); end if;
 -- An explicit correction replaces a collection atomically; absent members are otherwise retained.
 if correction is null and policy='entities' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by private.opportunity_merge_entity_key(canonical_field,value),value loop
     select array_agg(n::integer) into matches from jsonb_array_elements(r) with ordinality t(a,n)
       where case when canonical_field in ('contacts','supervisors') then private.opportunity_merge_person_match(a,v)
         when canonical_field='supervisor_top_papers' then private.opportunity_merge_paper_match(a,v)
         else private.opportunity_merge_entity_key(canonical_field,a)=private.opportunity_merge_entity_key(canonical_field,v) end;
     if cardinality(matches)>1 then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path',p_path,'status','conflicting','reason','ambiguous_entity','before',r,'after',r,'proposed',v));
       continue;
     end if;
     idx:=case when cardinality(matches)=1 then matches[1]-1 else jsonb_array_length(r) end;
     old_entry:=r->idx;
     if old_entry?'entity_id' and v->>'entity_id' like 'generated:%' then v:=jsonb_set(v,'{entity_id}',old_entry->'entity_id'); end if;
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_merge_entity_key(canonical_field,coalesce(old_entry,v)));
     child:=private.opportunity_merge_node(path,old_entry,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if private.opportunity_merge_present(child->'value') then r:=jsonb_set(r,array[idx::text],child->'value'); end if;
   end loop;
   select coalesce(jsonb_agg(a order by private.opportunity_merge_entity_key(canonical_field,a),a),'[]') into r from jsonb_array_elements(r) t(a);
 elsif correction is null and policy='salary' and jsonb_typeof(p_new)='object' then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   select coalesce(jsonb_object_agg(key,value),'{}') into old_quote from jsonb_each(r) where key=any(quote_keys);
   select coalesce(jsonb_object_agg(key,value),'{}') into new_quote from jsonb_each(p_new) where key=any(quote_keys);
   if new_quote<>'{}' then
     if ((new_quote ?| array['amount','min','max','currency','period']) and not (new_quote ?& array['currency','period']))
       or exists(select 1 from jsonb_object_keys(old_quote) t(qk) where not new_quote?qk) then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/salary/@quote','policy','assessment','status','conflicting','reason','incomplete_salary_quote',
         'before',old_quote,'after',old_quote,'proposed',new_quote));
     else
       child:=private.opportunity_merge_node('/salary/@quote',old_quote,new_quote,state,p_old_sources,p_new_sources,p_control);
       state:=child->'state'; decisions:=decisions||(child->'decisions');
       if jsonb_typeof(child->'value')='object' then r:=(r-quote_keys)||(child->'value'); end if;
     end if;
   end if;
   for k,v in select * from jsonb_each(p_new-quote_keys) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 elsif correction is null and policy='set' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by value loop
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_merge_key(v#>>'{}'));
     select a into old_entry from jsonb_array_elements(r) t(a) where private.opportunity_merge_key(a#>>'{}')=private.opportunity_merge_key(v#>>'{}');
     child:=private.opportunity_merge_node(path,old_entry,coalesce(old_entry,v),state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if old_entry is null and private.opportunity_merge_present(child->'value') then r:=r||jsonb_build_array(child->'value'); end if;
   end loop;
   r:=private.opportunity_merge_set(r);
 elsif correction is null and policy='recursive' and jsonb_typeof(p_new)='object'
   and (not private.opportunity_merge_present(p_old) or jsonb_typeof(p_old)='object') then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   for k,v in select * from jsonb_each(p_new) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 else
   entry:=state->p_path;
   -- Atomic parent corrections/revalidations supersede their old child bindings.
   if entry is null then
     for ancestor in select key,value from jsonb_each(state) where left(p_path,length(key)+1)=key||'/' order by length(key) desc loop
       if coalesce(private.opportunity_merge_value_at(ancestor.value->'value',substring(p_path from length(ancestor.key)+2),canonical_field),'null')
         is not distinct from coalesce(p_old,'null') then
         entry:=jsonb_build_object('value',coalesce(p_old,'null'),'evidence',ancestor.value->'evidence');
         bound:=true; exit;
       end if;
     end loop;
   else bound:=true; end if;
   -- Detect out-of-band edits rather than blessing the stale state's evidence.
   if entry is not null and entry->'value' is distinct from coalesce(p_old,'null') then
     old_e:=jsonb_build_array(jsonb_build_object('kind','unknown','supports','[]','legacy','out_of_band_change'));
   else old_e:=coalesce(entry->'evidence',private.opportunity_merge_evidence(p_old_sources,p_path)); end if;
   new_e:=private.opportunity_merge_evidence(p_new_sources,p_path);
   -- A whole-container correction must respect every effective descendant fact.
   if correction is not null and jsonb_typeof(p_old) in ('array','object') then
     select coalesce(jsonb_agg(distinct evidence),'[]') into old_e from (
       select evidence from jsonb_array_elements(old_e) t(evidence)
       union all select e from jsonb_each(state) t(sk,sv) cross join lateral jsonb_array_elements(coalesce(sv->'evidence','[]')) x(e)
         where left(sk,length(p_path)+1)=p_path||'/'
     ) all_evidence;
   end if;
   effective_absence:=bound and not private.opportunity_merge_present(p_old) and private.opportunity_merge_present(p_new);
   if effective_absence then
     select max(private.opportunity_search_evidence_time(s)) into old_t from jsonb_array_elements(old_e) t(s);
     select max(private.opportunity_merge_precise_time(s->>'checked_at')) into new_t from jsonb_array_elements(new_e) t(s)
       where private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school');
   end if;
   if policy='identity' then
     verdict:=case when not private.opportunity_merge_present(p_old) then 'accepted:new_canonical_identity' when p_old=p_new then 'unchanged' else 'conflicting:immutable_canonical_key' end;
   elsif p_path in ('/official_url','/source_url','/application_url') and private.opportunity_merge_url(p_old#>>'{}')=private.opportunity_merge_url(p_new#>>'{}') then
     verdict:='unchanged:equivalent_url';
   elsif policy='clock' then
     verdict:=case when not private.opportunity_merge_present(p_old) or (p_new#>>'{}')::timestamptz>(p_old#>>'{}')::timestamptz then 'accepted:monotonic_check_time'
       when (p_new#>>'{}')::timestamptz=(p_old#>>'{}')::timestamptz then 'unchanged' else 'rejected:older_check_time' end;
   else
     verdict:=private.opportunity_merge_authorize(p_old,p_new,old_e,new_e,correction);
   end if;
   if effective_absence and new_t<=old_t then
     if new_t<old_t then verdict:='rejected:stale_evidence_for_cleared_value';
     elsif correction is null or correction->'expected' is distinct from coalesce(p_old,'null')
       or not private.opportunity_merge_same_evidence(old_e,new_e) then
       verdict:='conflicting:cleared_value_requires_correction';
     end if;
   end if;
   if verdict like 'accepted:%' then
     r:=p_new;
     state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
   else
     r:=coalesce(p_old,'null');
     if entry is null then state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',old_e,'legacy',true)); end if;
     if verdict like 'unchanged%' and private.opportunity_merge_present(r) and private.opportunity_merge_can_revalidate(old_e,new_e) then
       state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
       verdict:='unchanged:same_value_revalidated';
     end if;
   end if;
   if jsonb_typeof(r) in ('object','array') and (verdict like 'accepted:%' or verdict='unchanged:same_value_revalidated') then
     select coalesce(jsonb_object_agg(key,value),'{}') into state from jsonb_each(state) where left(key,length(p_path)+1)<>p_path||'/';
   end if;
   decisions:=jsonb_build_array(jsonb_build_object('path',p_path,'policy',policy,'status',split_part(verdict,':',1),
     'reason',coalesce(nullif(split_part(verdict,':',2),''),'same_value'),'before',coalesce(p_old,'null'),'after',r,'proposed',p_new,
     'before_evidence',old_e,'after_evidence',coalesce(state#>array[p_path,'evidence'],old_e),'proposed_evidence',new_e,
     'correction_reason',correction->>'reason'));
 end if;
 return jsonb_build_object('value',coalesce(r,'null'),'state',state,'decisions',decisions);
end $$;

create or replace function private.opportunity_search_result_schema() returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_set(private.opportunity_merge_input_schema_v3(),'{properties}',
   (private.opportunity_merge_input_schema_v3()->'properties') || jsonb_build_object(
    'contacts', '{"type":"array","items":{"type":"object","properties":{"name":{"type":["string","null"]},"email":{"type":["string","null"]},"roles":{"type":"array","items":{"type":"string"}},"entity_id":{"type":"string"},"orcid":{"type":"string"}}}}'::jsonb,
    'supervisors', '{"type":"array","items":{"type":"object","properties":{"name":{"type":["string","null"]},"email":{"type":["string","null"]},"roles":{"type":"array","items":{"type":"string"}},"entity_id":{"type":"string"},"orcid":{"type":"string"}}}}'::jsonb,
    'requirements', '{"type":"array","items":{"type":"object","required":["text","status","stage"],"properties":{"text":{"type":"string"},"status":{"type":"string"},"stage":{"type":"string"}}}}'::jsonb,
    'required_documents', '{"type":"array","items":{"type":"object","required":["text","status","stage"],"properties":{"text":{"type":"string"},"status":{"type":"string"},"stage":{"type":"string"}}}}'::jsonb,
    'supervisor_top_papers','{"type":"array","items":{"type":"object"}}'::jsonb,
    'salary','{"type":"object","properties":{"amount":{"type":["number","null"]},"min":{"type":["number","null"]},"max":{"type":["number","null"]},"currency":{"type":["string","null"]},"period":{"type":["string","null"]},"gross":{"type":["boolean","null"]}}}'::jsonb,
    'merge_control','{"type":"object","additionalProperties":false,"properties":{"corrections":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["path","expected","reason"],"properties":{"path":{"type":"string","pattern":"^/","minLength":2},"expected":true,"reason":{"type":"string","minLength":1,"maxLength":4000}}}}}}'::jsonb
   )) || jsonb_build_object('x-canonical-version',4,'x-legacy-inputs',jsonb_build_object(
     'normalization','Legacy person strings/maps, grouped checklists, document/requirement aliases, salary text and grouped publications normalize before validation. Raw input and normalization diffs remain in the receipt.',
     'policies','Scalars use effective evidence; typed objects recurse; named sets normalize; entities match identities; assessments and unknown extension arrays are atomic.',
     'deadlines','ISO date, local time and established IANA/fixed offset remain separate columns. Changed dates with an existing exact time require an explicit date/time/zone tuple. Null clears require compare-and-set corrections.',
     'sources','supports accepts top-level fields or escaped JSON-pointer paths; historical sources are not automatically effective evidence.',
     'corrections','An explicit reason plus expected canonical value is required for same-evidence corrections. Never invent a later checked_at.'
   ))
$$;

create or replace function private.opportunity_search_support_field(p_field text) returns text
language sql immutable set search_path='' as $$
 select case when private.opportunity_search_result_schema()->'properties' ? root and root<>'merge_control'
   then case when field like '/%/%' then '/'||root||substring(field from length(split_part(ltrim(field,'/'),'/',1))+2) else root end else null end
 from (select case split_part(ltrim(p_field,'/'),'/',1) when 'documents' then 'required_documents' when 'contact' then 'contacts'
   when 'supervisor' then 'supervisors' when 'duration' then 'duration_details' when 'salary_text' then 'salary'
   when 'university' then 'institution' when 'application_documents' then 'required_documents' else split_part(ltrim(p_field,'/'),'/',1) end root,
   p_field field) t
$$;

create or replace function private.validate_opportunity_search_result(p jsonb) returns void
language plpgsql stable set search_path='' as $$
declare s jsonb; f text; c jsonb; schema jsonb:=private.opportunity_search_result_schema();
begin
 if p is null or octet_length(p::text)>262144 or not private.opportunity_search_schema_valid(p,schema) then
   raise exception 'Opportunity payload violates canonical result schema v4 or exceeds 256 KiB.' using errcode='22023';
 end if;
 if btrim(p->>'opportunity_key')='' or btrim(p->>'title')='' or (p->>'last_checked_at')::timestamptz>clock_timestamp()+interval '5 minutes' then
   raise exception 'Nonblank identity/title and a non-future check time are required.' using errcode='22023';
 end if;
 for s in select value from jsonb_array_elements(p->'sources') loop
   if (s->>'checked_at' like '%T%' and (s->>'checked_at')::timestamptz>clock_timestamp()+interval '5 minutes')
     or (s->>'checked_at' not like '%T%' and (s->>'checked_at')::date>(clock_timestamp() at time zone 'UTC')::date) then
     raise exception 'Future evidence timestamps are forbidden.' using errcode='22023';
   end if;
   for f in select jsonb_array_elements_text(s->'supports') loop
     if private.opportunity_search_support_field(f) is null then raise exception 'Unknown evidence field: %',f using errcode='22023'; end if;
   end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(p#>'{merge_control,corrections}','[]')) t(a) group by a->>'path' having count(*)>1) then
   raise exception 'Each correction path must be unique.' using errcode='22023';
 end if;
 for c in select value from jsonb_array_elements(coalesce(p#>'{merge_control,corrections}','[]')) loop
   if private.opportunity_search_support_field(c->>'path') is null or btrim(c->>'reason')='' then raise exception 'Invalid correction path/reason.' using errcode='22023'; end if;
 end loop;
 perform jsonb_populate_record(null::public.opportunities,p-'merge_control');
end $$;

create or replace function private.opportunity_merge_plan(p_before jsonb,p_payload jsonb,p_state jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare old jsonb:=private.opportunity_search_normalize_record(coalesce(nullif(p_before,'null'::jsonb),'{}'));
  incoming jsonb:=private.opportunity_search_normalize_record(p_payload); merged jsonb:=old;
  state jsonb:=coalesce(nullif(p_state,'null'::jsonb),jsonb_build_object('__legacy_sources',coalesce(old->'sources','[]')));
  decisions jsonb:='[]'; normalization jsonb:='[]'; k text; v jsonb; child jsonb; old_state jsonb;
  deadline_bad boolean:=false; clock_fields text[]:=array['deadline','deadline_time_local','deadline_timezone','deadline_original_text'];
  clock_decisions jsonb; normalized_payload jsonb;
begin
 -- Preserve alias raw input in the receipt, but never treat an alias as a SQL column.
 incoming:=incoming-array['contact','supervisor','documents','application_documents','salary_text','university'];
 perform private.validate_opportunity_search_result(incoming);
 normalized_payload:=incoming;
 for k,v in select * from jsonb_each(old) order by key loop
   if p_before->k is distinct from v then normalization:=normalization||jsonb_build_array(jsonb_build_object('field',k,'before',p_before->k,'after',v,'reason','legacy_normalization')); end if;
 end loop;
 -- Run the tuple against one state snapshot; one rejected member rejects the tuple.
 old_state:=state;
 foreach k in array clock_fields loop
   if not incoming?k then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,incoming->k,state,state->'__legacy_sources',incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions'); merged:=jsonb_set(merged,array[k],child->'value');
   if exists(select 1 from jsonb_array_elements(child->'decisions') t(a) where a->>'status' in ('rejected','conflicting')) then deadline_bad:=true; end if;
 end loop;
 if incoming?'deadline' and incoming->'deadline' is distinct from old->'deadline' and private.opportunity_merge_present(old->'deadline_time_local')
   and not (incoming ?& array['deadline','deadline_time_local','deadline_timezone']) then deadline_bad:=true; end if;
 if deadline_bad then
   select coalesce(jsonb_agg(case when a->>'status'='accepted' then a||jsonb_build_object('status','conflicting','reason','deadline_tuple_rejected','after',a->'before','after_evidence',a->'before_evidence') else a end),'[]') into decisions from jsonb_array_elements(decisions) t(a);
   state:=old_state;
   foreach k in array clock_fields loop
     if old?k then merged:=jsonb_set(merged,array[k],old->k); else merged:=merged-k; end if;
   end loop;
 end if;
 for k,v in select * from jsonb_each(incoming) order by key loop
   if k=any(clock_fields) or k in ('sources','merge_control') then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,v,state,state->'__legacy_sources',incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions');
   if child->'value'<>'null' or old?k then merged:=jsonb_set(merged,array[k],child->'value'); end if;
 end loop;
 -- The historical source log is lossless, but is never consulted as effective state.
 merged:=merged||jsonb_build_object('sources',private.opportunity_merge_canonical('sources',coalesce(old->'sources','[]')||(incoming->'sources')));
 decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/sources','policy','source_log','status',
   case when merged->'sources' is not distinct from old->'sources' then 'unchanged' else 'accepted' end,
   'reason','historical_claims_only_not_effective_evidence','before',old->'sources','after',merged->'sources','proposed',incoming->'sources'));
 decisions:=decisions||private.opportunity_merge_alias_conflicts(p_before)||private.opportunity_merge_alias_conflicts(p_payload);
 return jsonb_build_object('value',merged,'state',state,'decisions',decisions,'normalization',normalization,'normalized_payload',normalized_payload);
end $$;

create or replace function private.submit_opportunity_search_result(p_run_id uuid,p_item_id uuid,p_opportunity jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare run public.opportunity_search_runs; prior public.opportunity_search_receipts; candidates uuid[]; oid uuid;
  before_row jsonb; after_row jsonb; before_state jsonb; plan jsonb; merged jsonb; receipt jsonb;
  before_ids jsonb; after_ids jsonb; identity text; cols text; assignments text; conflicts jsonb; outcome text;
begin
 if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
 if p_item_id is null then raise exception 'A stable item UUID is required.' using errcode='22023'; end if;
 select * into run from public.opportunity_search_runs where id=p_run_id for update;
 if not found then raise exception 'Search run not found.' using errcode='P0002'; end if;
 select * into prior from public.opportunity_search_receipts where run_id=p_run_id and item_id=p_item_id;
 if found then
   if prior.payload is distinct from p_opportunity then raise exception 'An item UUID cannot be reused for changed evidence.' using errcode='23505'; end if;
   return prior.result||jsonb_build_object('verified',prior.verified_at is not null);
 end if;
 if run.status<>'running' or run.queries is null then raise exception 'An active run with saved queries is required.' using errcode='22023'; end if;
 -- Reject unknown top-level names before any normalization or dynamic SQL.
 if jsonb_typeof(p_opportunity) is distinct from 'object' or octet_length(p_opportunity::text)>262144 or exists(
   select 1 from jsonb_object_keys(p_opportunity) t(k) where not (private.opportunity_search_result_schema()->'properties')?k
   and k<>all(array['contact','supervisor','documents','application_documents','salary_text','university'])) then
   raise exception 'Unknown/protected opportunity fields or oversized payload.' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opportunity-search-catalogue-v1',0));
 candidates:=private.opportunity_search_matches(private.opportunity_search_normalize_record(p_opportunity));
 if cardinality(candidates)>1 then raise exception 'Ambiguous opportunity identity; review without merging.' using errcode='23505'; end if;
 oid:=candidates[1];
 if oid is not null then
   select to_jsonb(o) into before_row from public.opportunities o where id=oid for update;
   select fields into before_state from private.opportunity_search_merge_state where opportunity_id=oid;
   if nullif(btrim(before_row->>'vacancy_id'),'') is not null and nullif(btrim(p_opportunity->>'vacancy_id'),'') is not null
     and lower(btrim(before_row->>'vacancy_id'))<>lower(btrim(p_opportunity->>'vacancy_id'))
     and not (before_row->>'opportunity_key'=p_opportunity->>'opportunity_key' and exists(
       select 1 from jsonb_array_elements(coalesce(p_opportunity#>'{merge_control,corrections}','[]')) t(c)
       where c->>'path'='/vacancy_id' and c->'expected'=before_row->'vacancy_id' and btrim(c->>'reason')<>'')) then
     raise exception 'Conflicting vacancy IDs require review.' using errcode='23505';
   end if;
 end if;
 select coalesce(jsonb_agg(identity_key order by identity_key),'[]') into before_ids from private.opportunity_search_identities where opportunity_id=oid;
 plan:=private.opportunity_merge_plan(before_row,p_opportunity,before_state); merged:=plan->'value';
 if not private.opportunity_merge_present(merged->'title') or not private.opportunity_merge_present(merged->'opportunity_key') then
   raise exception 'Identity and title need accepted official evidence for a new record.' using errcode='23514';
 end if;
 -- The submitted allowlist plus normalization changes are the only writable columns.
 -- Protected values from before_row cannot become assignments.
 select string_agg(format('%I',k),',' order by k),
   string_agg(format('%1$I=(jsonb_populate_record(null::public.opportunities,$1)).%1$I',k),',' order by k)
 into cols,assignments from jsonb_object_keys(merged) t(k)
 where (private.opportunity_search_result_schema()->'properties')?k and k<>'merge_control'
   and (before_row is null or merged->k is distinct from before_row->k);
 if oid is null then
   execute format('insert into public.opportunities(%1$s) select %1$s from jsonb_populate_record(null::public.opportunities,$1) returning to_jsonb(opportunities)',cols) into after_row using merged;
   oid:=(after_row->>'id')::uuid; outcome:='new';
 elsif assignments is not null then
   execute 'update public.opportunities set '||assignments||',updated_at=clock_timestamp() where id=$2 returning to_jsonb(opportunities)' into after_row using merged,oid;
   outcome:=case when exists(select 1 from jsonb_array_elements(plan->'decisions') t(d)
     where d->>'status'='accepted' and d->'before' is distinct from d->'after' and d->>'path' not in ('/last_checked_at','/sources'))
       or plan->'normalization'<>'[]' then 'updated' else 'unchanged' end;
 else after_row:=before_row; outcome:='unchanged'; end if;
 insert into private.opportunity_search_merge_state values(oid,plan->'state') on conflict(opportunity_id) do update set fields=excluded.fields;
 -- Only an explicit evidenced vacancy-ID correction retires its erroneous alias.
 if before_row->'vacancy_id' is distinct from after_row->'vacancy_id' and exists(
   select 1 from jsonb_array_elements(coalesce(p_opportunity#>'{merge_control,corrections}','[]')) t(c) where c->>'path'='/vacancy_id') then
   delete from private.opportunity_search_identities where opportunity_id=oid and identity_key='vacancy:'||lower(btrim(before_row->>'institution'))||':'||lower(btrim(before_row->>'vacancy_id'));
 end if;
 foreach identity in array (private.opportunity_search_identity_keys(after_row)||array['key:'||(p_opportunity->>'opportunity_key')]) loop
   insert into private.opportunity_search_identities values(identity,oid) on conflict(identity_key) do nothing;
   if not exists(select 1 from private.opportunity_search_identities where identity_key=identity and opportunity_id=oid) then
     raise exception 'Identity claimed concurrently; review canonical records.' using errcode='40001';
   end if;
 end loop;
 select coalesce(jsonb_agg(identity_key order by identity_key),'[]') into after_ids from private.opportunity_search_identities where opportunity_id=oid;
 select coalesce(jsonb_agg(distinct split_part(d->>'path','/',2)),'[]') into conflicts from jsonb_array_elements(plan->'decisions') t(d) where d->>'status' in ('rejected','conflicting');
 receipt:=jsonb_build_object('merge_version',4,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',oid,'opportunity_key',after_row->>'opportunity_key',
   'outcome',outcome,'before_snapshot',before_row,'snapshot',after_row,'conflicts',conflicts,'field_decisions',plan->'decisions',
   'normalization',plan->'normalization','normalized_payload',plan->'normalized_payload','previous_assessments',
     (select coalesce(jsonb_object_agg(f,before_row->f),'{}') from unnest(array['personal_fit','rd_career_potential','research_career_potential']) f
      where before_row->f is not null and before_row->f is distinct from after_row->f),'verified',false);
 insert into private.opportunity_search_merge_audit(run_id,item_id,opportunity_id,before_snapshot,after_snapshot,before_state,after_state,before_identities,after_identities,decisions)
   values(p_run_id,p_item_id,oid,before_row,after_row,before_state,plan->'state',before_ids,after_ids,plan->'decisions');
 insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result) values(p_run_id,p_item_id,run.user_id,oid,p_opportunity,receipt);
 return receipt;
end $$;

-- Two phases: preview returns blockers; apply rechecks under the same catalogue lock.
-- New rows are deliberately not deleted; removal requires separate explicit approval.
create function private.rollback_opportunity_search_merge(p_run_id uuid,p_apply boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare a record; current_row jsonb; current_state jsonb; current_ids jsonb; simulated jsonb:='{}'; simulated_state jsonb:='{}'; simulated_ids jsonb:='{}';
  blockers jsonb:='[]'; count_items integer:=0; k text; assignments text;
begin
 if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opportunity-search-catalogue-v1',0));
 if exists(select 1 from public.opportunity_search_runs where id=p_run_id and status='running') then
   raise exception 'Finish/stop the run before rollback.' using errcode='23514'; end if;
 if not exists(select 1 from private.opportunity_search_merge_audit where run_id=p_run_id) then
   return jsonb_build_object('applied',false,'blockers',jsonb_build_array('No v4 before-snapshots: reconstructing or guessing a historical rollback is forbidden.'));
 end if;
 for a in select * from private.opportunity_search_merge_audit where run_id=p_run_id and rolled_back_at is null order by sequence desc loop
   k:=a.opportunity_id::text; count_items:=count_items+1;
   if simulated?k then current_row:=simulated->k; current_state:=simulated_state->k; current_ids:=simulated_ids->k;
   else
     select to_jsonb(o) into current_row from public.opportunities o where id=a.opportunity_id for update;
     select fields into current_state from private.opportunity_search_merge_state where opportunity_id=a.opportunity_id;
     select coalesce(jsonb_agg(identity_key order by identity_key),'[]') into current_ids from private.opportunity_search_identities where opportunity_id=a.opportunity_id;
   end if;
   if a.before_snapshot is null then blockers:=blockers||jsonb_build_array(jsonb_build_object('opportunity_id',a.opportunity_id,'reason','new_record_removal_requires_separate_approval'));
   elsif current_row is distinct from a.after_snapshot or current_state is distinct from a.after_state or current_ids is distinct from a.after_identities then
     blockers:=blockers||jsonb_build_array(jsonb_build_object('opportunity_id',a.opportunity_id,'reason','changed_after_run'));
   end if;
   simulated:=simulated||jsonb_build_object(k,a.before_snapshot); simulated_state:=simulated_state||jsonb_build_object(k,a.before_state); simulated_ids:=simulated_ids||jsonb_build_object(k,a.before_identities);
 end loop;
 if p_apply and blockers<>'[]' then raise exception 'Rollback blocked: %',blockers using errcode='40001'; end if;
 if p_apply then
   for a in select * from private.opportunity_search_merge_audit where run_id=p_run_id and rolled_back_at is null order by sequence desc loop
     select string_agg(format('%1$I=(jsonb_populate_record(null::public.opportunities,$1)).%1$I',attname),',') into assignments
       from pg_catalog.pg_attribute where attrelid='public.opportunities'::regclass and attnum>0 and not attisdropped and attname<>'id';
     execute 'update public.opportunities set '||assignments||' where id=$2' using a.before_snapshot,a.opportunity_id;
     if a.before_state is null then delete from private.opportunity_search_merge_state where opportunity_id=a.opportunity_id;
     else update private.opportunity_search_merge_state set fields=a.before_state where opportunity_id=a.opportunity_id; end if;
     delete from private.opportunity_search_identities where opportunity_id=a.opportunity_id;
     insert into private.opportunity_search_identities select value,a.opportunity_id from jsonb_array_elements_text(a.before_identities);
     update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where sequence=a.sequence;
   end loop;
 end if;
 return jsonb_build_object('applied',p_apply,'items',count_items,'blockers',blockers);
end $$;

-- Keep the receipt immutable and make rollback visible during separate verification.
create or replace function private.verify_opportunity_search_result(p_run_id uuid,p_item_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare r public.opportunity_search_receipts; current_row jsonb; ids uuid[];
begin
 if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
 select * into r from public.opportunity_search_receipts where run_id=p_run_id and item_id=p_item_id for update;
 if not found then raise exception 'No saved receipt.' using errcode='P0002'; end if;
 ids:=private.opportunity_search_matches(r.payload);
 if cardinality(ids)<>1 or ids[1]<>r.opportunity_id then raise exception 'Canonical identity verification failed.' using errcode='23514'; end if;
 select to_jsonb(o) into current_row from public.opportunities o where id=r.opportunity_id;
 update public.opportunity_search_receipts set verified_at=coalesce(verified_at,clock_timestamp()) where run_id=p_run_id and item_id=p_item_id;
 return r.result||jsonb_build_object('verified',true,'current_snapshot',current_row,'changed_since_save',current_row is distinct from r.result->'snapshot',
   'rolled_back',exists(select 1 from private.opportunity_search_merge_audit where run_id=p_run_id and item_id=p_item_id and rolled_back_at is not null));
end $$;

CREATE OR REPLACE FUNCTION private.inspect_opportunity_search_result(p_run_id uuid, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare entry record; candidates uuid[]; snapshot jsonb;
begin
  if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
  if not exists(select 1 from public.opportunity_search_runs where id=p_run_id and status='running') then
    raise exception 'An active search run is required.' using errcode='22023';
  end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object' or octet_length(p_identity::text)>16384 then
    raise exception 'Supply only opportunity identity fields.' using errcode='22023';
  end if;
  if (p_identity-array['opportunity_key','institution','vacancy_id','official_url','source_url','application_url','data'])<>'{}'::jsonb then
    raise exception 'Supply only opportunity identity fields.' using errcode='22023';
  end if;
  for entry in select * from jsonb_each(p_identity) loop
    if entry.key='data' then
      if jsonb_typeof(entry.value)<>'object' or (entry.value-'url_roles')<>'{}'::jsonb
        or not private.opportunity_search_schema_valid(entry.value,private.opportunity_search_result_schema()#>'{properties,data}') then
        raise exception 'Inspection data accepts only valid url_roles.' using errcode='22023';
      end if;
      continue;
    end if;
    if jsonb_typeof(entry.value)<>'string' or char_length(btrim(entry.value#>>'{}')) not between 1 and 2000 then
      raise exception 'Identity fields must be nonempty strings.' using errcode='22023';
    end if;
  end loop;
  if cardinality(private.opportunity_search_identity_keys(p_identity))=0 then
    raise exception 'Supply a canonical key, institution-scoped vacancy ID or vacancy-specific URL.' using errcode='22023';
  end if;
  candidates:=private.opportunity_search_matches(p_identity);
  if cardinality(candidates)>1 then raise exception 'Ambiguous opportunity identity; preserve both records for review.' using errcode='23505'; end if;
  select to_jsonb(o) into snapshot from public.opportunities o where id=candidates[1];
  return jsonb_build_object('match_count',cardinality(candidates),'opportunity_id',candidates[1],'snapshot',snapshot,
    'canonical_snapshot',private.opportunity_search_normalize_record(snapshot),
    'effective_fields',coalesce((select fields from private.opportunity_search_merge_state where opportunity_id=candidates[1]),'{}'::jsonb));
end;
$function$
;

-- Least privilege: these remain administrative connector helpers, never browser RPCs.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and (p.proname like 'opportunity_merge_%' or p.proname in ('submit_opportunity_search_result','rollback_opportunity_search_merge','verify_opportunity_search_result','inspect_opportunity_search_result')) loop
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;

-- Publish a new immutable protocol, preserving the previous release and pinned runs.
insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
select 'opportunity-search-v1-merge-4',1,encode(sha256(convert_to(protocol_text||E'\n'||addition||private.opportunity_search_result_schema()::text,'UTF8')),'hex'),
  protocol_text||E'\n'||addition,private.opportunity_search_result_schema()
from private.opportunity_search_protocols p cross join (select $protocol$
MERGE CONTRACT 4 (supersedes older merge/normalization wording above)
Canonical shapes: contacts/supervisors are identity-matched objects with names, emails, ORCIDs and roles; requirements/documents are arrays of {text,status,stage,...}. Preserve required/optional/conditional, conditions and application stages. Legacy grouped/string representations normalize losslessly and raw submissions remain in receipts. Publications match DOI/URL/title. Salary quotes keep their currency/period; partial amount changes without units conflict. Date changes with an existing exact local time require date/time/timezone together. Do not infer a time, timezone, degree requirement or score scale.
Field policies are explicit: scalars require effective official evidence; objects merge type-safely per leaf; named sets normalize; entities match identities; complete assessments replace atomically; unknown extension arrays are atomic. Missing/empty values do not silently erase facts. Effective evidence is attached to each stored value independently of the historical source log. Rejected fields never advance it. Source supports may use escaped JSON-pointer paths for precise coverage.
Equal timestamps with different values conflict by default. A legitimate correction against the SAME evidence uses merge_control.corrections:[{path:"/field/or/leaf",expected:<exact canonical old value>,reason:"specific evidence interpretation correction"}]. Use the separate inspection canonical_snapshot (raw snapshot remains available), and effective_fields for stored evidence; do not fabricate checked_at or reuse a saved item UUID. Collection replacement/clearing also requires explicit compare-and-set correction. A failed expected-value comparison cannot override concurrent edits. Different official authorities require explicit correction and non-stale evidence.
Inspect field_decisions: accepted, rejected, unchanged, conflicting, with before/after/proposed values and effective evidence. A successful receipt proves only the returned accepted values. normalization diffs and complete before/saved snapshots preserve legacy values. Separately verify as before; changed_since_save or rolled_back must be reported honestly. Never issue catalogue maintenance or rollback yourself; these require an explicit administrative request.
$protocol$ addition) t where p.version=(select active_protocol_version from private.opportunity_search_settings where singleton);
update private.opportunity_search_settings set active_protocol_version='opportunity-search-v1-merge-4' where singleton;

commit;
