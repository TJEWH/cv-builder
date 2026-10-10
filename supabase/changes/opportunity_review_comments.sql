-- Apply once to an existing workspace after opportunity_review_receipts.sql.
-- Private comments use the existing owner RLS and never edit shared research.
begin;

alter table public.opportunity_reviews
  add column comment text constraint opportunity_reviews_comment_length
    check (char_length(comment) <= 5000);
comment on column public.opportunity_reviews.comment is
  'Private optional context for the owner''s interest choice; independent of review state and source-version receipt.';

create function public.save_opportunity_comment(p_opportunity_id uuid, p_comment text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  comment_text text := nullif(regexp_replace(p_comment, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  saved public.opportunity_reviews;
begin
  if account is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if char_length(comment_text) > 5000 then
    raise exception 'Opportunity comments must be 5000 characters or fewer' using errcode = '22023';
  end if;
  perform 1 from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity unavailable' using errcode = '42501';
  end if;
  -- Change only the comment so parallel interest/receipt updates cannot be lost.
  insert into public.opportunity_reviews (user_id, opportunity_id, comment)
    values (account, p_opportunity_id, comment_text)
    on conflict (user_id, opportunity_id) do update
      set comment = excluded.comment
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.save_opportunity_comment(uuid, text) from public, anon;
grant execute on function public.save_opportunity_comment(uuid, text) to authenticated;

commit;
