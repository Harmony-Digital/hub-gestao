-- Hub de Gestão · 0028 · relatório aprovado também por e-mail aos contatos (RF-34)
--
-- Opção do projeto (desligada por padrão): quando o dono aprova um relatório de status
-- para o cliente, além de publicar no portal, o Hub manda o texto aprovado por e-mail aos
-- contatos do cliente com acesso ativo e com o aceite do uso dos dados (LGPD). Ligar e
-- desligar é da equipe, no Editar projeto; agente nunca muda a opção (a mesma regra da
-- trava de 0009 para as regras do projeto).

alter table proj_hub_gestao.projects
  add column email_client_reports boolean not null default false;

create function proj_hub_gestao.projects_report_email_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if proj_hub_gestao.current_actor_type() = 'agent'
     and ((tg_op = 'INSERT' and new.email_client_reports)
       or (tg_op = 'UPDATE' and new.email_client_reports is distinct from old.email_client_reports))
  then
    raise exception 'agentes não ligam o envio de relatório por e-mail ao cliente'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger projects_report_email_guard
  before insert or update of email_client_reports on proj_hub_gestao.projects
  for each row execute function proj_hub_gestao.projects_report_email_guard();
