-- Hub de Gestão · 0014 · evidência cobrada ao concluir, não em toda gravação
--
-- O gatilho da tarefa cobrava a evidência em qualquer gravação de uma tarefa concluída.
-- Tarefa concluída sem evidência num projeto que passou a exigir evidência ficava travada:
-- não aceitava nem mudar o título, nem a posição no Quadro, nem passar para outro status
-- da mesma categoria (como ao remover um status). A regra passa a valer quando a tarefa
-- entra em Concluída e quando a evidência de uma tarefa concluída é trocada. O resto do
-- gatilho não muda.

create or replace function proj_hub_gestao.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category proj_hub_gestao.status_category;
  v_check_evidence boolean;
begin
  select s.category into v_category
  from proj_hub_gestao.task_statuses s
  where s.id = new.status_id and s.project_id = new.project_id;
  if v_category is null then
    raise exception 'status % não pertence ao projeto %', new.status_id, new.project_id;
  end if;
  new.status_category := v_category;

  -- Data de conclusão controlada aqui, para nunca ficar inconsistente.
  if new.status_category = 'done' then
    if new.completed_at is null then
      new.completed_at := pg_catalog.now();
    end if;
    -- Regra do projeto: concluir exige evidência (decisão da Harmony, padrão ligado). Vale ao
    -- entrar em Concluída e ao trocar a evidência; a tarefa concluída antes de o projeto
    -- passar a exigir evidência continua editável.
    if tg_op = 'INSERT' then
      v_check_evidence := true;
    else
      v_check_evidence := old.status_category is distinct from 'done'
        or new.done_evidence is distinct from old.done_evidence;
    end if;
    if v_check_evidence
      and coalesce(pg_catalog.btrim(new.done_evidence), '') = ''
      and exists (
        select 1 from proj_hub_gestao.projects pr
        where pr.id = new.project_id and pr.require_evidence
      ) then
      raise exception 'evidência obrigatória para concluir a tarefa %', new.code
        using errcode = 'check_violation';
    end if;
  else
    new.completed_at := null;
    new.completed_by_type := null;
    new.completed_by_id := null;
  end if;

  if new.parent_task_id is not null then
    if not exists (
      select 1 from proj_hub_gestao.tasks p
      where p.id = new.parent_task_id and p.project_id = new.project_id and p.parent_task_id is null
    ) then
      raise exception 'subtarefa precisa de uma tarefa-pai do mesmo projeto, com um nível só';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
