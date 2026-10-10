-- Hub de Gestão · 0012 · recusas de acesso dos agentes
--
-- A Sala de Controle mostra quando um agente tenta algo e o Hub recusa: sem permissão
-- (403), agente pausado (423) ou chave revogada ou vencida (401). A recusa acontece fora
-- da transação que falhou (ela é desfeita), então o registro entra por uma função
-- SECURITY DEFINER, chamada pelo servidor. Chave desconhecida não é registrada, para
-- ninguém encher a tabela com tentativas falsas. Cada workspace guarda 90 dias.
--
-- Leitura: a equipe interna do workspace. Escrita: só pela função.

create table proj_hub_gestao.agent_denials (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  agent_id uuid references proj_hub_gestao.agents(id) on delete cascade,
  key_prefix text check (key_prefix is null or char_length(key_prefix) <= 40),
  source text not null check (source in ('api', 'mcp')),
  status smallint not null check (status in (401, 403, 423)),
  action text not null check (char_length(action) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create index agent_denials_workspace_idx
  on proj_hub_gestao.agent_denials (workspace_id, created_at desc);
create index agent_denials_agent_idx
  on proj_hub_gestao.agent_denials (agent_id, created_at desc);

alter table proj_hub_gestao.agent_denials enable row level security;

create policy agent_denials_internal_read on proj_hub_gestao.agent_denials for select
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

create function proj_hub_gestao.record_agent_denial(
  p_workspace uuid,
  p_agent uuid,
  p_key_prefix text,
  p_source text,
  p_status integer,
  p_action text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_workspace is null or p_agent is null
     or p_source not in ('api', 'mcp') or p_status not in (401, 403, 423)
     or coalesce(btrim(p_action), '') = '' or coalesce(btrim(p_reason), '') = '' then
    return;
  end if;
  -- O agente precisa ser do workspace informado.
  if not exists (
    select 1 from proj_hub_gestao.agents a
     where a.id = p_agent and a.workspace_id = p_workspace
  ) then
    return;
  end if;
  insert into proj_hub_gestao.agent_denials
    (workspace_id, agent_id, key_prefix, source, status, action, reason)
  values (
    p_workspace, p_agent, left(p_key_prefix, 40), p_source, p_status,
    left(btrim(p_action), 200), left(btrim(p_reason), 500)
  );
  delete from proj_hub_gestao.agent_denials
   where workspace_id = p_workspace and created_at < now() - interval '90 days';
end
$$;
revoke all on function proj_hub_gestao.record_agent_denial(uuid, uuid, text, text, integer, text, text) from public;

-- O papel do app em produção lê a tabela (pela RLS) e chama a função (no banco local o
-- papel é outro e recebe as permissões ao subir).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant select on proj_hub_gestao.agent_denials to hub_gestao_app;
    grant execute on function proj_hub_gestao.record_agent_denial(uuid, uuid, text, text, integer, text, text) to hub_gestao_app;
  end if;
end
$$;
