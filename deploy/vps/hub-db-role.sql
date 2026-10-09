-- Hub de Gestão · papel de banco próprio do servidor (M2)
--
-- MUDANÇA GLOBAL no Supabase compartilhado: só roda com autorização específica do Fábio.
-- Roda como "postgres" dentro do contêiner supabase-db (mesmo caminho usado no projeto
-- Carla Mileia RH). O passo a passo está em deploy/vps/README.md, seção "Papel de banco".
--
-- A senha nunca passa por aqui: o psql recebe só o verificador SCRAM-SHA-256, calculado
-- na própria VPS por hub-db-verifier.py, na variável :hub_verifier. Assim nem o log do
-- Postgres nem o histórico do terminal guardam a senha em texto.
--
-- O papel entra no banco, obedece à RLS (o Hub confere isso ao subir, em
-- app/src/lib/db/guard.ts) e só enxerga o schema proj_hub_gestao.

\set ON_ERROR_STOP on

select format(
  'create role hub_gestao_app login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 20 password %L',
  :'hub_verifier'
)
where not exists (select 1 from pg_roles where rolname = 'hub_gestao_app')
\gexec

select format('alter role hub_gestao_app password %L', :'hub_verifier')
where exists (select 1 from pg_roles where rolname = 'hub_gestao_app')
\gexec

alter role hub_gestao_app set statement_timeout = '15s';
alter role hub_gestao_app set idle_in_transaction_session_timeout = '60s';

grant usage on schema proj_hub_gestao to hub_gestao_app;
grant select, insert, update, delete on all tables in schema proj_hub_gestao to hub_gestao_app;
grant usage, select on all sequences in schema proj_hub_gestao to hub_gestao_app;
-- Inclui as consultas de autenticação (agent_key_lookup, workspace_id_by_slug e
-- profile_for_auth_user), que ninguém mais executa.
grant execute on all functions in schema proj_hub_gestao to hub_gestao_app;

-- Tabelas e funções das próximas migrations (aplicadas como postgres) já nascem liberadas.
alter default privileges for role postgres in schema proj_hub_gestao
  grant select, insert, update, delete on tables to hub_gestao_app;
alter default privileges for role postgres in schema proj_hub_gestao
  grant usage, select on sequences to hub_gestao_app;
alter default privileges for role postgres in schema proj_hub_gestao
  grant execute on functions to hub_gestao_app;

-- Conferência: o papel não pode passar por cima da RLS nem ser dono de nada do Hub.
select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
  from pg_roles where rolname = 'hub_gestao_app';
