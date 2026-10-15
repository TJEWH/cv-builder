-- Add bounded spelling corrections without changing stored requests or proposals.
-- Apply this targeted upgrade before deploying the client that emits fix_typos.
begin;

create or replace function public.refinement_close_spelling(before_word text, after_word text, budget integer)
returns boolean language plpgsql immutable strict security invoker set search_path='' as $$
declare position integer:=1; before_length integer:=char_length(before_word); after_length integer:=char_length(after_word);
begin
  if budget<0 or budget>2 or greatest(before_length,after_length)>64 then return false; end if;
  while position<=least(before_length,after_length) and substr(before_word,position,1)=substr(after_word,position,1) loop
    position:=position+1;
  end loop;
  if position>least(before_length,after_length) then return abs(before_length-after_length)<=budget; end if;
  if budget=0 or abs(before_length-after_length)>budget then return false; end if;
  return public.refinement_close_spelling(substr(before_word,position+1),substr(after_word,position+1),budget-1)
    or public.refinement_close_spelling(substr(before_word,position+1),substr(after_word,position),budget-1)
    or public.refinement_close_spelling(substr(before_word,position),substr(after_word,position+1),budget-1)
    or (substr(before_word,position,1)=substr(after_word,position+1,1)
      and substr(before_word,position+1,1)=substr(after_word,position,1)
      and public.refinement_close_spelling(substr(before_word,position+2),substr(after_word,position+2),budget-1));
end;
$$;

create or replace function public.refinement_validate_typo_fix(original text, replacement text, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  whitespace text:=E'[[:space:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';
  spelling_pattern text:=E'^([^[:alnum:]\u0300-\u036F]*)([[:alpha:]\u0300-\u036F]+)([^[:alnum:]\u0300-\u036F]*)$';
  before_words text[]; after_words text[]; before_parts text[]; after_parts text[]; position integer;
begin
  if original is null or replacement is null or replacement=original or btrim(replacement,whitespace_chars)=''
    or public.refinement_utf16_length(replacement)>20000 then
    raise exception 'A typo correction must change bounded nonempty text.' using errcode='22023';
  end if;
  if regexp_replace(original,'[^'||substr(whitespace,2,char_length(whitespace)-2)||']+','X','g')
    <>regexp_replace(replacement,'[^'||substr(whitespace,2,char_length(whitespace)-2)||']+','X','g') then
    raise exception 'Typo corrections must preserve whitespace and word count.' using errcode='22023';
  end if;
  before_words:=regexp_split_to_array(original,whitespace||'+');
  after_words:=regexp_split_to_array(replacement,whitespace||'+');
  if cardinality(before_words)<>cardinality(after_words) then
    raise exception 'Typo corrections cannot add or remove words.' using errcode='22023';
  end if;
  for position in 1..cardinality(before_words) loop
    if before_words[position]=after_words[position] then continue; end if;
    before_parts:=regexp_match(before_words[position],spelling_pattern);
    after_parts:=regexp_match(after_words[position],spelling_pattern);
    if before_parts is null or after_parts is null or before_parts[1]<>after_parts[1] or before_parts[3]<>after_parts[3]
      or not public.refinement_close_spelling(before_parts[2],after_parts[2],case when least(char_length(before_parts[2]),char_length(after_parts[2]))<5 then 1 else 2 end) then
      raise exception 'Typo corrections allow only small spelling changes and preserve punctuation, numbers and protected content.' using errcode='22023';
    end if;
  end loop;
  perform public.cv_adjustment_validate_response(
    jsonb_build_object('schemaVersion',1,'requestId',expected_id,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',translate(replacement,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),
    jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id','field-1','text',translate(original,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),expected_id);
end;
$$;

revoke all on function public.refinement_close_spelling(text,text,integer), public.refinement_validate_typo_fix(text,text,uuid) from public,anon,service_role;
grant execute on function public.refinement_close_spelling(text,text,integer), public.refinement_validate_typo_fix(text,text,uuid) to authenticated;

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

commit;
