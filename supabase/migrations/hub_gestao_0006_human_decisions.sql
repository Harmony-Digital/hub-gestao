-- Hub de Gestão · 0006 · Decisões humanas
-- "A IA executa. O humano decide." também dentro do banco (PRD RF-10 e RF-25, decisão D9):
-- - só uma pessoa, agindo em nome próprio, decide uma aprovação;
-- - decisão registrada não muda depois (um novo pedido gera uma nova aprovação);
-- - só uma pessoa, em nome próprio, aceita um marco ou desfaz um aceite.
-- Agente, sistema e conexões sem contexto de ator são recusados.

create function proj_hub_gestao.approvals_guard_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status in ('approved', 'rejected', 'adjust_requested', 'cancelled')
     and (new.status, new.decided_by_profile_id, new.decided_at, new.decision_note)
         is distinct from (old.status, old.decided_by_profile_id, old.decided_at, old.decision_note)
  then
    raise exception 'aprovação já encerrada não pode mudar; abra um novo pedido'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status in ('approved', 'rejected', 'adjust_requested')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    if proj_hub_gestao.current_actor_type() is distinct from 'user'
       or new.decided_by_profile_id is distinct from proj_hub_gestao.current_actor_id()
    then
      raise exception 'somente uma pessoa decide uma aprovação, em nome próprio'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;
create trigger approvals_guard_decision before insert or update on proj_hub_gestao.approvals
  for each row execute function proj_hub_gestao.approvals_guard_decision();

create function proj_hub_gestao.milestones_guard_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Aceitar um marco.
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    if proj_hub_gestao.current_actor_type() is distinct from 'user'
       or new.accepted_by_profile_id is distinct from proj_hub_gestao.current_actor_id()
    then
      raise exception 'somente uma pessoa aceita um marco, em nome próprio'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'accepted' then
    if new.status = 'accepted' then
      -- Aceite registrado não muda de autor nem de data.
      if (new.accepted_by_profile_id, new.accepted_at)
         is distinct from (old.accepted_by_profile_id, old.accepted_at)
      then
        raise exception 'aceite registrado não pode ser alterado'
          using errcode = 'insufficient_privilege';
      end if;
    else
      -- Desfazer um aceite também é decisão de uma pessoa.
      if proj_hub_gestao.current_actor_type() is distinct from 'user' then
        raise exception 'somente uma pessoa desfaz o aceite de um marco'
          using errcode = 'insufficient_privilege';
      end if;
      new.accepted_at := null;
      new.accepted_by_profile_id := null;
    end if;
  end if;

  return new;
end;
$$;
create trigger milestones_guard_acceptance before insert or update on proj_hub_gestao.milestones
  for each row execute function proj_hub_gestao.milestones_guard_acceptance();
