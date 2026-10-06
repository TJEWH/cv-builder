-- Optional user-authored research interests and question guidance in frozen templates.
-- Apply after structured_cv_refinement.sql (UTF-16 length helper).
-- CREATE OR REPLACE preserves the existing function owner and execution privileges.
begin;

create or replace function public.refinement_validate_setup(value jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare template jsonb := value->'template'; item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>200000
    or value - array['template','language','maxWords'] <> '{}'::jsonb or not(value ?& array['template','language','maxWords'])
    or jsonb_typeof(value->'language') is distinct from 'string' or char_length(value->>'language') not between 1 and 30
    or jsonb_typeof(value->'maxWords') is distinct from 'number' or coalesce(value->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (value->>'maxWords')::integer not between 50 and 2000
    or jsonb_typeof(template) is distinct from 'object'
    or template - array['id','name','revision','structure','tone','language','maxWords','updatedAt','subjectInstructions','salutationInstructions','closingInstructions','exampleText','researchInterests','questionGuidance'] <> '{}'::jsonb
    or not(template ?& array['id','name','revision','structure','tone','language','maxWords','updatedAt'])
    or jsonb_typeof(template->'revision') is distinct from 'number' or coalesce(template->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(template->'maxWords') is distinct from 'number' or coalesce(template->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (template->>'maxWords')::integer not between 50 and 2000 then
    raise exception 'Invalid refinement letter template or word target.' using errcode='22023';
  end if;
  for item in select key,val from jsonb_each(template-array['revision','maxWords']) e(key,val) loop
    if jsonb_typeof(item.val) is distinct from 'string' or char_length(item.val#>>'{}')>20000
      or (item.key in ('subjectInstructions','salutationInstructions','closingInstructions') and char_length(item.val#>>'{}')>1000)
      or (item.key in ('researchInterests','questionGuidance') and public.refinement_utf16_length(item.val#>>'{}')>4000)
      or translate(item.val#>>'{}', E'\t\n\r','') ~ '[[:cntrl:]]' then
      raise exception 'Invalid refinement template text.' using errcode='22023';
    end if;
  end loop;
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement text before publishing.' using errcode='22023';
  end if;
end;
$$;

commit;
