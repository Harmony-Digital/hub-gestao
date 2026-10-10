-- Hub de Gestão · 0011 · conteúdo dos anexos
--
-- Os arquivos anexados ficam no próprio schema do Hub (bytea), com até 10 MB cada. O plano
-- previa um bucket privado do Supabase Storage, mas criar bucket mexe no schema global
-- `storage` do Supabase compartilhado, o que só acontece com autorização do Fábio. O
-- registro em `attachments` guarda nome, tipo e tamanho; `storage_path = 'db'` indica que
-- o conteúdo está aqui. Trocar para o Storage depois é só mudar o caminho de gravação.
--
-- Leitura: quem enxerga o registro do anexo (RLS de attachments) enxerga o conteúdo.
-- Escrita e remoção: só a equipe interna do workspace.

create table proj_hub_gestao.attachment_contents (
  attachment_id uuid primary key references proj_hub_gestao.attachments(id) on delete cascade,
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea not null check (octet_length(content) between 1 and 10485760)
);

create index attachment_contents_workspace_idx
  on proj_hub_gestao.attachment_contents (workspace_id);

alter table proj_hub_gestao.attachment_contents enable row level security;

create policy attachment_contents_read on proj_hub_gestao.attachment_contents for select
  using (
    exists (
      select 1 from proj_hub_gestao.attachments a
       where a.id = attachment_contents.attachment_id
    )
  );

create policy attachment_contents_insert on proj_hub_gestao.attachment_contents for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

create policy attachment_contents_delete on proj_hub_gestao.attachment_contents for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- O papel do app em produção recebe acesso à tabela nova (no banco local o papel é outro
-- e recebe as permissões ao subir).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant select, insert, delete on proj_hub_gestao.attachment_contents to hub_gestao_app;
  end if;
end
$$;
