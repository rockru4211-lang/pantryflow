-- The full client has no direct public-table writes: all business changes use
-- the authorized RPCs (or authenticated Edge Functions). In particular, a
-- self-profile UPDATE must never allow a caller to promote their own role.
revoke insert,update,delete on all tables in schema public from anon,authenticated;
alter default privileges for role postgres in schema public revoke insert,update,delete on tables from anon,authenticated;
-- Storage uploads and Auth password changes use their own schemas/services.
