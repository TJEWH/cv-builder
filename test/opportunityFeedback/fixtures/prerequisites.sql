-- Synthetic structure only. The actual workspace tables, RLS and RPCs are loaded
-- from supabase/schema.sql. AF-01 reads just these existing search evidence fields.
-- No historical captures, connection strings, production rows or search runner.
create table public.opportunity_search_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Synthetic search',
  criteria jsonb not null default '{}',
  schedule jsonb not null default '{}',
  revision integer not null default 1,
  meta_search jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.opportunity_search_templates enable row level security;
grant select,insert,update,delete on public.opportunity_search_templates to authenticated;
create policy owner_search_templates on public.opportunity_search_templates for all to authenticated
  using (user_id=auth.uid() and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false))
  with check (user_id=auth.uid() and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false));
create table public.opportunity_search_runs (
  id uuid primary key,
  search_id uuid,
  user_id uuid not null
);
create table public.opportunity_search_receipts (
  run_id uuid not null references public.opportunity_search_runs(id),
  item_id uuid not null,
  user_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id),
  verified_at timestamptz,
  primary key (run_id,item_id)
);
create table private.opportunity_search_merge_audit (
  run_id uuid not null,
  item_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id),
  after_snapshot jsonb not null,
  recorded_at timestamptz not null,
  rolled_back_at timestamptz,
  primary key (run_id,item_id)
);
alter table public.opportunity_search_runs enable row level security;
alter table public.opportunity_search_receipts enable row level security;
alter table private.opportunity_search_merge_audit enable row level security;
revoke all on public.opportunity_search_runs,public.opportunity_search_receipts,
  private.opportunity_search_merge_audit from public,anon,authenticated;
