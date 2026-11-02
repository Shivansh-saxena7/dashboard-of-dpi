-- Rollback for 2026-11-02_restore_refusal_info.sql: puts the one log line back ('error' for every refusal).
begin;
do $do$
declare
  v_def text := pg_get_functiondef('public.mark_lead_junk_atomic(uuid,uuid,text)'::regprocedure);
  v_old text := $t$perform log_anomaly('db_auto_junk_guard', case when v_block like 'restored by an admin%' then 'info' else 'error' end,$t$;
  v_new text := $t$perform log_anomaly('db_auto_junk_guard', 'error',$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'restore_refusal_info rollback: patched line not found';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;
commit;
