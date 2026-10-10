-- Keep elevated execution outside the exposed API schema.
-- Apply after refinement_clear_history.sql; no history or document data changes.
begin;
alter function private.clear_refinement_history(uuid,integer) security definer;
alter function private.clear_refinement_history(uuid,integer) owner to postgres;
alter function public.clear_refinement_history(uuid,integer) security invoker;
-- USAGE permits resolving this helper; existing management helpers retain their
-- revoked EXECUTE grants and cannot be called by authenticated users.
grant usage on schema private to authenticated;
grant execute on function private.clear_refinement_history(uuid,integer) to authenticated;
commit;
