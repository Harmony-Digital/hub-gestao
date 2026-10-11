-- Hub de Gestão · 0026 · anexos até 25 MB (PRD §8.8, RF-18)
--
-- O limite de cada anexo (das tarefas e dos arquivos entregues ao cliente) sobe de 10 MB
-- para 25 MB, como pede o PRD. O conteúdo continua no próprio schema do Hub (0011); o
-- servidor confere o tamanho antes, e o banco segura o limite de qualquer forma.

alter table proj_hub_gestao.attachment_contents
  drop constraint attachment_contents_content_check;
alter table proj_hub_gestao.attachment_contents
  add constraint attachment_contents_content_check
    check (octet_length(content) between 1 and 26214400);
