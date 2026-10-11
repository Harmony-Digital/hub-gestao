-- Hub de Gestão · 0019 · o projeto de cada execução de IA (custo de IA por projeto)
--
-- O TO-15 (Controlador de Tempo e Orçamento, M7) consolida o custo de IA por projeto.
-- As execuções dos agentes internos (Planejador, Redator do Cliente) passam a guardar o
-- projeto a que servem. Execução sem projeto (Concierge, Testar conexão) fica com null e
-- entra só no total do agente. Projeto apagado não apaga o custo: a ligação vira null.

alter table proj_hub_gestao.agent_runs
  add column project_id uuid references proj_hub_gestao.projects(id) on delete set null;

create index agent_runs_project_idx
  on proj_hub_gestao.agent_runs (project_id, started_at desc)
  where project_id is not null;
