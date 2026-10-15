-- Allow explicitly published titles and headings to receive spelling corrections only.
-- Requires refinement_typo_fixes.sql; apply before deploying the matching client.
-- Existing range shapes and stored requests/proposals remain unchanged.
begin;

create or replace function public.refinement_validate_cv_structure(value jsonb, fields jsonb)
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
      if not public.refinement_exact_keys(item,case when category='ranges' and item ? 'typoOnly' then array_append(keys,'typoOnly') else keys end) or jsonb_typeof(item->'id') is distinct from 'string'
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
    if item ? 'typoOnly' and (item->'typoOnly' is distinct from 'true'::jsonb or item->'bulletId' is distinct from 'null'::jsonb) then
      raise exception 'A typo-only range must be a whole field and explicitly marked true.' using errcode='22023';
    end if;
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

create or replace function public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  item jsonb; target jsonb; original text; replacement text; expected jsonb; structure jsonb:=request_value->'cvStructure';
  ids text[]:='{}'; targets text[]:='{}'; omitted text[]:='{}'; shortened_bullets text[]:='{}'; corrected_bullets text[]:='{}'; edited_ranges text[]:='{}'; signature text;
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
    elsif item->>'type' in ('shorten_text','fix_typos') then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','text']) or jsonb_typeof(item->'text') is distinct from 'string' then raise exception 'Invalid CV text operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->'ranges') e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV text range.' using errcode='22023'; end if;
      if item->>'targetId'=any(edited_ranges) then raise exception 'Conflicting CV text operations target the same range.' using errcode='22023'; end if;
      edited_ranges:=array_append(edited_ranges,item->>'targetId');
      original:=target->>'text'; replacement:=item->>'text';
      if item->>'type'='fix_typos' then
        if target->>'bulletId' is not null and replacement~E'[\r\n]' then raise exception 'A corrected bullet must occupy one line.' using errcode='22023'; end if;
        perform public.refinement_validate_typo_fix(original,replacement,expected_id);
        if target->>'bulletId' is not null then corrected_bullets:=array_append(corrected_bullets,target->>'bulletId'); end if;
        continue;
      end if;
      if target->'typoOnly'='true'::jsonb then raise exception 'This CV range permits spelling corrections only.' using errcode='22023'; end if;
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
  if omitted && corrected_bullets then raise exception 'A CV bullet cannot be omitted and corrected in one proposal.' using errcode='22023'; end if;
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

revoke all on function public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid) from public,anon,service_role;
grant execute on function public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid) to authenticated;

commit;
