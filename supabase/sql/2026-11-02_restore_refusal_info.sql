-- 2026-11-02 — Restore-protection junk refusals are logged as 'info', not 'error'. NOT APPLIED — apply only after the owner's "haan" (LF copy).
-- Apply AFTER 2026-10-29_reminder_hold.sql (that file replaces mark_lead_junk_atomic and would drop this change).
-- Rollback: 2026-11-02_restore_refusal_info_rollback.sql   Tests (dry-run only): 2026-11-02_restore_refusal_info_tests.sql
--
-- A protected lead the sweep tries to junk is refused every 15 minutes, and each refusal counted as a system error
-- (3cc8037d: 194 in 2 days) although the guard did exactly what it should. Only the severity of that one log line
-- changes: the refusal, the guard event, the warning and every other refusal (still 'error') stay as they are.
-- Patched on the live definition, so the rest of the function stays byte for byte.
begin;
do $do$
declare
  v_def text := pg_get_functiondef('public.mark_lead_junk_atomic(uuid,uuid,text)'::regprocedure);
  v_old text := $t$perform log_anomaly('db_auto_junk_guard', 'error',$t$;
  v_new text := $t$perform log_anomaly('db_auto_junk_guard', case when v_block like 'restored by an admin%' then 'info' else 'error' end,$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'restore_refusal_info: expected exactly one log line to patch';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;
commit;
