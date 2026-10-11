-- Hub de Gestão · 0022 · logo do cliente (RF-04)
--
-- O logo do cliente aparece na tela Clientes e no topo do portal. O arquivo fica numa
-- tabela própria, um por cliente: PNG, JPEG ou WebP, até 1 MB (SVG fica de fora: o
-- navegador executa script dentro dele). A equipe envia e remove; o contato do cliente
-- lê só o logo do próprio cliente; agente nunca grava. A coluna clients.logo_path, da
-- 0001, fica sem uso.

create table proj_hub_gestao.client_logos (
  client_id uuid primary key references proj_hub_gestao.clients(id) on delete cascade,
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea not null check (octet_length(content) between 1 and 1048576),
  updated_at timestamptz not null default now()
);

create index client_logos_workspace_idx on proj_hub_gestao.client_logos (workspace_id);

alter table proj_hub_gestao.client_logos enable row level security;

create policy client_logos_read on proj_hub_gestao.client_logos for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and client_id = (select proj_hub_gestao.current_client_id())
      )
    )
  );
create policy client_logos_insert on proj_hub_gestao.client_logos for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy client_logos_update on proj_hub_gestao.client_logos for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy client_logos_delete on proj_hub_gestao.client_logos for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Agente nunca grava o logo (como os cadastros, na 0009).
create trigger client_logos_agent_guard before insert or update or delete on proj_hub_gestao.client_logos
  for each row execute function proj_hub_gestao.agent_never_writes();

-- O papel do app em produção recebe acesso à tabela nova (no banco local o papel é outro
-- e recebe as permissões ao subir).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant select, insert, update, delete on proj_hub_gestao.client_logos to hub_gestao_app;
  end if;
end
$$;
