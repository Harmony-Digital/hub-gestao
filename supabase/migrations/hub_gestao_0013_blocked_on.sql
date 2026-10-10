-- Hub de Gestão · 0013 · quem destrava a tarefa bloqueada
--
-- Ao bloquear, quem bloqueia pode dizer de quem a tarefa depende para andar (uma pessoa ou
-- um agente do workspace). A tela Hoje separa "os bloqueios que dependem de você", e quem
-- foi indicado recebe um aviso. O campo é limpo quando a tarefa sai do bloqueio.

alter table proj_hub_gestao.tasks
  add column blocked_on_type proj_hub_gestao.actor_type,
  add column blocked_on_id uuid,
  add constraint tasks_blocked_on_pair
    check ((blocked_on_type is null) = (blocked_on_id is null)),
  add constraint tasks_blocked_on_kind
    check (blocked_on_type is null or blocked_on_type in ('user', 'agent'));

create index tasks_blocked_on_idx
  on proj_hub_gestao.tasks (blocked_on_type, blocked_on_id)
  where blocked_on_id is not null;
