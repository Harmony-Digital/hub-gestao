-- Hub de Gestão · permissões do papel do servidor no schema (M8, runbook)
--
-- As mesmas permissões de hub-db-role.sql, sem criar o papel nem mexer na senha. Serve
-- para devolver o acesso do hub_gestao_app depois de uma restauração completa do schema
-- (o dump é feito sem permissões, e apagar o schema leva junto as permissões padrão).
-- Roda como "postgres" dentro do contêiner supabase-db, só com a ordem do Fábio:
--   docker exec -i supabase-db psql --host=127.0.0.1 --username=postgres --dbname=postgres < hub-db-grants.sql

\set ON_ERROR_STOP on

grant usage on schema proj_hub_gestao to hub_gestao_app;
grant select, insert, update, delete on all tables in schema proj_hub_gestao to hub_gestao_app;
grant usage, select on all sequences in schema proj_hub_gestao to hub_gestao_app;
grant execute on all functions in schema proj_hub_gestao to hub_gestao_app;

alter default privileges for role postgres in schema proj_hub_gestao
  grant select, insert, update, delete on tables to hub_gestao_app;
alter default privileges for role postgres in schema proj_hub_gestao
  grant usage, select on sequences to hub_gestao_app;
alter default privileges for role postgres in schema proj_hub_gestao
  grant execute on functions to hub_gestao_app;

-- Conferência: o papel continua sem passar por cima da RLS.
select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'hub_gestao_app';
