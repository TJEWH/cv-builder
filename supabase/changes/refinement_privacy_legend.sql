-- Optional user-approved context for existing public tokens; private originals and maps stay local.
-- Apply after refinement_annotations.sql. Older v1/v2 requests remain valid.
create or replace function public.refinement_validate_privacy_legend(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; seen text[]:='{}'; source_text text;
begin
  if jsonb_typeof(value) is distinct from 'array' then raise exception 'Invalid privacy legend.' using errcode='22023'; end if;
  if jsonb_array_length(value)>1000 then raise exception 'Privacy legend is too large.' using errcode='22023'; end if;
  for item in select jsonb_array_elements(value) loop
    if not public.refinement_exact_keys(item,array['fieldId','token','type','description'])
      or jsonb_typeof(item->'fieldId') is distinct from 'string'
      or jsonb_typeof(item->'token') is distinct from 'string' or item->>'token' !~ '^\{\{PRIVATE_[1-9][0-9]*\}\}$'
      or coalesce(item->>'type','') not in ('person','organization','location','link','contact','confidential','other')
      or jsonb_typeof(item->'description') is distinct from 'string'
      or coalesce(btrim(item->>'description', E' \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'),'')='' or public.refinement_utf16_length(item->>'description')>500
      or item->>'description' ~ '[[:cntrl:]]|!!|\{\{|\}\}|<|>' then
      raise exception 'Invalid approved privacy context.' using errcode='22023';
    end if;
    select field->>'text' into source_text from jsonb_array_elements(fields) field where field->>'id'=item->>'fieldId';
    if source_text is null or position(item->>'token' in source_text)=0 or item->>'token'=any(seen) then
      raise exception 'Privacy context must reference a unique token in its original field.' using errcode='22023';
    end if;
    seen:=array_append(seen,item->>'token');
  end loop;
end;
$$;
revoke all on function public.refinement_validate_privacy_legend(jsonb,jsonb) from public, anon, service_role;
grant execute on function public.refinement_validate_privacy_legend(jsonb,jsonb) to authenticated;

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
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
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
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
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
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare
  edit jsonb; original text; replacement text; ids text[] := '{}';
  original_lines jsonb; replacement_lines jsonb;
  original_tokens text[]; replacement_tokens text[]; original_links text[]; replacement_links text[];
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','edits'] <> '{}'::jsonb or not (value ?& array['schemaVersion','requestId','edits'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'edits') is distinct from 'array' then
    raise exception 'Invalid CV adjustment response.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'edits') > 1000 then raise exception 'Too many CV adjustment edits.' using errcode = '22023'; end if;
  for edit in select jsonb_array_elements(value->'edits') loop
    if jsonb_typeof(edit) is distinct from 'object' or edit - array['fieldId','text'] <> '{}'::jsonb
      or not (edit ?& array['fieldId','text'])
      or jsonb_typeof(edit->'fieldId') is distinct from 'string' or edit->>'fieldId' !~ '^field-[1-9][0-9]*$' or edit->>'fieldId' = any(ids)
      or jsonb_typeof(edit->'text') is distinct from 'string' or char_length(edit->>'text') > 20000
      or translate(edit->>'text', E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment edit.' using errcode = '22023';
    end if;
    ids := array_append(ids, edit->>'fieldId');
    select field->>'text' into original from jsonb_array_elements(request_value->'fields') as fields(field) where field->>'id' = edit->>'fieldId';
    if not found then raise exception 'The response edits an unavailable CV field.' using errcode = '22023'; end if;
    replacement := edit->>'text';
    if replacement = original then continue; end if;
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into original_tokens
      from regexp_matches(original, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into replacement_tokens
      from regexp_matches(replacement, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    if original_tokens <> replacement_tokens
      or regexp_replace(replacement, '\{\{PRIVATE_[1-9][0-9]*\}\}', '', 'g') ~ '\{\{|\}\}'
      or position('!!' in replacement) > 0 then
      raise exception 'Private placeholders must remain in their original field, order and count.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into original_lines
      from regexp_split_to_table(original,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into replacement_lines
      from regexp_split_to_table(replacement,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    if original_lines<>replacement_lines then raise exception 'Private tokens must remain attached to their original bullet or content line.' using errcode='22023'; end if;
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into original_links
      from regexp_matches(original, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into replacement_links
      from regexp_matches(replacement, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    if original_links <> replacement_links or replacement ~* '!\[|</?[a-z]|\]\([^)]*\{\{' then
      raise exception 'CV adjustments cannot add links, images or HTML.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.refinement_capture_request() from public, anon, authenticated, service_role;
revoke all on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) to authenticated;
