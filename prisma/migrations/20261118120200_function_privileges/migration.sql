-- Functions created after the Supabase hardening still received PostgreSQL's built-in EXECUTE grant to PUBLIC: a
-- per-schema default privilege cannot remove a built-in default. Revoke it from the existing functions and, for every
-- function the migration role creates from now on, globally. Trigger functions need no EXECUTE privilege to fire;
-- ara_app keeps its explicit grants.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
