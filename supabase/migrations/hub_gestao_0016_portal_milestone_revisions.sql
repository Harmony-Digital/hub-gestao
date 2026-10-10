-- Hub de Gestão · 0016 · revisões de data dos marcos no portal (RF-11)
--
-- O portal mostra a data vigente de cada marco e quantas vezes ela foi revista, nunca o
-- motivo, que é interno. O histórico de datas (milestone_date_history) continua só da
-- equipe: o cliente recebe só a contagem, por esta função, e só dos marcos que ele já
-- enxerga (marcados para o cliente, não arquivados, de projeto dele que não esteja em
-- revisão nem arquivado). Revisão é mudança de uma data que já existia; marcar a
-- primeira data não conta.

create function proj_hub_gestao.client_milestone_revisions(p_project_id uuid)
returns table (milestone_id uuid, revisions integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, count(h.id)::integer
    from proj_hub_gestao.milestones m
    join proj_hub_gestao.milestone_date_history h
      on h.milestone_id = m.id and h.old_due is not null
   where m.project_id = p_project_id
     and m.visibility = 'client'
     and m.archived_at is null
     and proj_hub_gestao.project_visible_to_client(p_project_id)
   group by m.id
$$;

revoke all on function proj_hub_gestao.client_milestone_revisions(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.client_milestone_revisions(uuid) to hub_gestao_app;
  end if;
end;
$$;
