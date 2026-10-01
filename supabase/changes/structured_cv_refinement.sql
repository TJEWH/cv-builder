-- Additive structured CV contract. Existing version-1 requests/proposals are unchanged.
begin;

-- Match JavaScript String.length for new structured-contract size limits.
-- On UTF8 PostgreSQL, ascii(character) returns its Unicode code point.
create function public.refinement_utf16_length(value text)
returns integer language sql immutable strict security invoker set search_path='' as $$
  select coalesce(sum(case when ascii(character)>65535 then 2 else 1 end),0)::integer
    from string_to_table(value,null) as characters(character);
$$;

create function public.refinement_exact_keys(value jsonb, keys text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(value)='object' and value-keys='{}'::jsonb and value ?& keys,false);
$$;

create function public.refinement_reference_permutation(value jsonb, expected jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare actual_values text[]; expected_values text[];
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>1000
    or exists(select 1 from jsonb_array_elements(value) e where jsonb_typeof(e)<>'string') then
    raise exception 'CV order must contain a complete reference list.' using errcode='22023';
  end if;
  select coalesce(array_agg(v order by v),'{}') into actual_values from jsonb_array_elements_text(value) v;
  select coalesce(array_agg(v order by v),'{}') into expected_values from jsonb_array_elements_text(expected) v;
  if actual_values<>expected_values or cardinality(actual_values)<>(select count(distinct v) from unnest(actual_values) v) then
    raise exception 'CV order must be an exact permutation within its existing parent.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_validate_cv_structure(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  category text; item jsonb; expected jsonb; ids text[]; fields_map jsonb; sections_map jsonb; entries_map jsonb; bullets_map jsonb;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  keys text[]; id_pattern text; range_targets text[]:='{}'; unsupported_fields text[]:='{}'; range_target text;
begin
  if not public.refinement_exact_keys(value,array['schemaVersion','areas','sections','entries','bullets','ranges','unsupported'])
    or value->'schemaVersion' is distinct from '1'::jsonb then raise exception 'Invalid structured CV context.' using errcode='22023'; end if;
  foreach category in array array['areas','sections','entries','bullets','ranges','unsupported'] loop
    if jsonb_typeof(value->category) is distinct from 'array' or jsonb_array_length(value->category)>1000 then raise exception 'Invalid structured CV list.' using errcode='22023'; end if;
    if category='unsupported' then continue; end if;
    keys:=case category
      when 'areas' then array['id','sectionIds'] when 'sections' then array['id','label','area','entryIds']
      when 'entries' then array['id','sectionId','label','bulletIds'] when 'bullets' then array['id','entryId','fieldId','text']
      else array['id','fieldId','bulletId','text','label'] end;
    id_pattern:=case category when 'areas' then '^(body|sidebar)$' when 'sections' then '^section-[1-9][0-9]*$'
      when 'entries' then '^entry-[1-9][0-9]*$' when 'bullets' then '^bullet-[1-9][0-9]*$' else '^range-[1-9][0-9]*$' end;
    ids:='{}';
    for item in select jsonb_array_elements(value->category) loop
      if not public.refinement_exact_keys(item,keys) or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~ id_pattern or item->>'id'=any(ids) then raise exception 'Invalid or duplicate structured CV reference.' using errcode='22023'; end if;
      ids:=array_append(ids,item->>'id');
      if category='bullets' and item->>'text'~E'[\r\n]' then raise exception 'A CV bullet must occupy one line.' using errcode='22023'; end if;
      if category in ('sections','entries','ranges') and (jsonb_typeof(item->'label') is distinct from 'string'
        or public.refinement_utf16_length(item->>'label')>200 or btrim(item->>'label',whitespace_chars)='' or translate(item->>'label',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV label.' using errcode='22023';
      end if;
      if category in ('bullets','ranges') and (jsonb_typeof(item->'text') is distinct from 'string'
        or public.refinement_utf16_length(item->>'text')>20000 or btrim(item->>'text',whitespace_chars)='' or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV text.' using errcode='22023';
      end if;
    end loop;
  end loop;
  perform public.refinement_reference_permutation((select coalesce(jsonb_agg(e->'id'),'[]') from jsonb_array_elements(value->'areas') e),'["body","sidebar"]');
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into fields_map from jsonb_array_elements(fields) e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into sections_map from jsonb_array_elements(value->'sections') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into entries_map from jsonb_array_elements(value->'entries') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into bullets_map from jsonb_array_elements(value->'bullets') e;
  for item in select jsonb_array_elements(value->'areas') loop
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'sections') e where e->>'area'=item->>'id';
    perform public.refinement_reference_permutation(item->'sectionIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'sections') loop
    if coalesce(item->>'area','') not in ('body','sidebar') then raise exception 'Unknown CV area.' using errcode='22023'; end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'entries') e where e->'sectionId'=item->'id';
    perform public.refinement_reference_permutation(item->'entryIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'entries') loop
    if not coalesce(sections_map ? (item->>'sectionId'),false) then raise exception 'Unknown CV section.' using errcode='22023'; end if;
    if (select count(distinct e->>'fieldId') from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id')>1 then
      raise exception 'An entry can expose bullets from only one field.' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id';
    perform public.refinement_reference_permutation(item->'bulletIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'bullets') loop
    if not coalesce(entries_map ? (item->>'entryId'),false) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or position(item->>'text' in fields_map->(item->>'fieldId')->>'text')=0 then
      raise exception 'CV bullet must belong to an authorized field and entry.' using errcode='22023';
    end if;
  end loop;
  for item in select jsonb_array_elements(value->'ranges') loop
    if not coalesce(fields_map ? (item->>'fieldId'),false) or jsonb_typeof(item->'bulletId') not in ('string','null') then raise exception 'Unknown CV text range.' using errcode='22023'; end if;
    if item->'bulletId'='null'::jsonb then
      if item->'text' is distinct from fields_map->(item->>'fieldId')->'text'
        or exists(select 1 from jsonb_array_elements(value->'bullets') e where e->'fieldId'=item->'fieldId') then
        raise exception 'A prose range must match its whole non-bullet field.' using errcode='22023';
      end if;
    elsif not coalesce(bullets_map ? (item->>'bulletId'),false)
      or item->'fieldId' is distinct from bullets_map->(item->>'bulletId')->'fieldId'
      or item->'text' is distinct from bullets_map->(item->>'bulletId')->'text' then
      raise exception 'A bullet range must exactly match its authorized bullet.' using errcode='22023';
    end if;
    range_target:=(item->>'fieldId')||':'||coalesce(item->>'bulletId','');
    if range_target=any(range_targets) then raise exception 'Duplicate CV range target.' using errcode='22023'; end if;
    range_targets:=array_append(range_targets,range_target);
  end loop;
  for item in select jsonb_array_elements(value->'unsupported') loop
    if not public.refinement_exact_keys(item,array['fieldId','reason']) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or item->>'fieldId'=any(unsupported_fields) or jsonb_typeof(item->'reason') is distinct from 'string'
      or exists(select 1 from jsonb_array_elements((value->'bullets')||(value->'ranges')) e where e->'fieldId'=item->'fieldId')
      or public.refinement_utf16_length(item->>'reason')>1000 or btrim(item->>'reason',whitespace_chars)='' or translate(item->>'reason',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid unsupported CV field.' using errcode='22023';
    end if;
    unsupported_fields:=array_append(unsupported_fields,item->>'fieldId');
  end loop;
end;
$$;

create function public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  item jsonb; target jsonb; original text; replacement text; expected jsonb; structure jsonb:=request_value->'cvStructure';
  ids text[]:='{}'; targets text[]:='{}'; omitted text[]:='{}'; shortened_bullets text[]:='{}'; signature text;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  words text[]; word text; cursor_index integer; total integer; whitespace text:=E'[[:space:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+';
begin
  if jsonb_typeof(value->'cvOperations') is distinct from 'array' or jsonb_typeof(value->'cvComments') is distinct from 'array'
    or jsonb_array_length(value->'cvOperations')>1000 or jsonb_array_length(value->'cvComments')>1000 then
    raise exception 'Invalid CV operations or comments.' using errcode='22023';
  end if;
  for item in select jsonb_array_elements(value->'cvOperations') loop
    if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^change-[1-9][0-9]*$' or item->>'id'=any(ids)
      or jsonb_typeof(item->'targetId') is distinct from 'string' or jsonb_typeof(item->'explanation') is distinct from 'string'
      or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)='' or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid CV change ID, target or explanation.' using errcode='22023';
    end if;
    ids:=array_append(ids,item->>'id');
    signature:=(item->>'type')||':'||(item->>'targetId');
    if signature=any(targets) then raise exception 'Duplicate CV operation target.' using errcode='22023'; end if;
    targets:=array_append(targets,signature);
    if item->>'type' in ('reorder_sections','reorder_entries','reorder_bullets') then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','order']) then raise exception 'Invalid CV reorder operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->(case item->>'type' when 'reorder_sections' then 'areas' when 'reorder_entries' then 'sections' else 'entries' end)) e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV reorder target.' using errcode='22023'; end if;
      expected:=target->(case item->>'type' when 'reorder_sections' then 'sectionIds' when 'reorder_entries' then 'entryIds' else 'bulletIds' end);
      if jsonb_array_length(expected)=0 then raise exception 'An empty CV container cannot be reordered.' using errcode='22023'; end if;
      perform public.refinement_reference_permutation(item->'order',expected);
    elsif item->>'type'='omit_bullet' then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation'])
        or not exists(select 1 from jsonb_array_elements(structure->'bullets') e where e->'id'=item->'targetId') then raise exception 'Unknown CV omission target.' using errcode='22023'; end if;
      omitted:=array_append(omitted,item->>'targetId');
    elsif item->>'type'='shorten_text' then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','text']) or jsonb_typeof(item->'text') is distinct from 'string' then raise exception 'Invalid CV shortening operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->'ranges') e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV shortening range.' using errcode='22023'; end if;
      original:=target->>'text'; replacement:=item->>'text';
      if target->>'bulletId' is not null and replacement~E'[\r\n]' then raise exception 'A shortened bullet must occupy one line.' using errcode='22023'; end if;
      if public.refinement_utf16_length(replacement)>20000 or char_length(replacement)>=char_length(original) or regexp_replace(replacement,whitespace,'','g')='' then raise exception 'A shortened range must be nonempty and strictly shorter.' using errcode='22023'; end if;
      select coalesce(array_agg(v order by n),'{}') into words from regexp_split_to_table(original,whitespace) with ordinality as w(v,n) where v<>'';
      cursor_index:=1; total:=cardinality(words);
      for word in select v from regexp_split_to_table(replacement,whitespace) v where v<>'' loop
        while cursor_index<=total and words[cursor_index]<>word loop cursor_index:=cursor_index+1; end loop;
        if cursor_index>total then raise exception 'Shortening may only remove original words in their existing order.' using errcode='22023'; end if;
        cursor_index:=cursor_index+1;
      end loop;
      -- Normalize only the synthetic validation view so the legacy POSIX link
      -- regex sees the same whitespace boundaries as JavaScript. Keep character
      -- counts unchanged so shortening cannot trigger its unchanged-text shortcut.
      perform public.cv_adjustment_validate_response(
        jsonb_build_object('schemaVersion',1,'requestId',expected_id,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',translate(replacement,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),
        jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id','field-1','text',translate(original,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),expected_id);
      if target->>'bulletId' is not null then shortened_bullets:=array_append(shortened_bullets,target->>'bulletId'); end if;
    else raise exception 'Unsupported CV operation.' using errcode='22023'; end if;
  end loop;
  if omitted && shortened_bullets then raise exception 'A CV bullet cannot be omitted and shortened in one proposal.' using errcode='22023'; end if;
  ids:='{}';
  for item in select jsonb_array_elements(value->'cvComments') loop
    if not public.refinement_exact_keys(item,array['id','fieldId','explanation']) or jsonb_typeof(item->'id') is distinct from 'string'
      or item->>'id' !~ '^comment-[1-9][0-9]*$' or item->>'id'=any(ids)
      or not exists(select 1 from jsonb_array_elements(request_value#>'{cv,fields}') e where e->'id'=item->'fieldId')
      or jsonb_typeof(item->'explanation') is distinct from 'string' or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)=''
      or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then raise exception 'Invalid CV comment.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
end;
$$;

create function public.refinement_validate_cv_decisions(value jsonb, proposal jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare expected jsonb;
begin
  if not public.refinement_exact_keys(value,array['proposalId','accepted','rejected','revision'])
    or jsonb_typeof(value->'proposalId') is distinct from 'string'
    or jsonb_typeof(value->'revision') is distinct from 'string' or value->>'revision' !~ '^v1:[a-f0-9]{64}$'
    or jsonb_typeof(value->'accepted') is distinct from 'array' or jsonb_typeof(value->'rejected') is distinct from 'array' then
    raise exception 'Invalid CV decision payload.' using errcode='22023';
  end if;
  if proposal->'schemaVersion'='2'::jsonb then
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(proposal->'cvOperations') e;
  else
    select coalesce(jsonb_agg(e->'fieldId'),'[]') into expected from jsonb_array_elements(proposal->'cvEdits') e;
  end if;
  perform public.refinement_reference_permutation((value->'accepted')||(value->'rejected'),expected);
end;
$$;

alter table public.application_refinement_reviews drop constraint application_refinement_reviews_kind_check;
alter table public.application_refinement_reviews add constraint application_refinement_reviews_kind_check
  check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter','cv_decisions'));

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure']
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  if value->'schemaVersion'='2'::jsonb then perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign an anonymized CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='feedback' then
    if new.payload-array['text','scope']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from state.current_request_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if jsonb_array_length(new.payload->'accepted')>0 and state.approvals_json->'cv'<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText']
      else array['schemaVersion','requestId','summary','cvEdits','letterText'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb)
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!!|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if value->'schemaVersion'='2'::jsonb then
    perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  else
    perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

-- Pure validators expose no stored data. Owner request/review triggers need these
-- invoker calls; the unchanged proposal write path still requires postgres.
revoke all on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) to authenticated;
revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;

commit;
