-- 2026-10-16 — B1: 7 Admin-reviewed cross-owner duplicate merges (run ONLY after "B1 chalao").
-- Needs 2026-10-16_merge_cross_owner_duplicate.sql applied first. Run as an admin session
-- (merge_cross_owner_duplicate checks is_admin()). ..2151 deliberately skipped (different projects).
-- Rollback: 2026-10-16_b1_cross_owner_merges_rollback.sql
select merge_cross_owner_duplicate(k.id, d.id, p.kind, 'B1 reviewed 2026-10-16')
from (values (1,'bdb9a3f2','a8da5628','VISIT'), (2,'bdb9a3f2','51a61592','VISIT'), (3,'d3139b5c','f9582f1c','VISIT'),
             (4,'4ccd453e','3244ee5e','VISIT'), (5,'7479ee6e','9e1e4a3a','VISIT'), (6,'45e6e5fb','56a9556d','FOLLOW_UP'),
             (7,'a1a080c6','6773d58e','FOLLOW_UP')) p(n, keep8, drop8, kind)
join leads k on left(k.id::text, 8) = p.keep8
join leads d on left(d.id::text, 8) = p.drop8
order by p.n;
