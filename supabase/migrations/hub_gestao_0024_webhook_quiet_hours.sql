-- Hub de Gestão · 0024 · horário de silêncio dos webhooks (RF-33)
--
-- Os avisos que o Hub manda por webhook (para o Telegram, pelo Hermes) respeitam o
-- silêncio das 23h às 8h, no fuso do workspace: o que acontece nesse horário sai às 8h.
-- Os alertas de operação (system.*: publicação, job ou backup com falha) saem na hora.
-- Ligado por padrão; o dono desliga por webhook na Sala de Controle.

alter table proj_hub_gestao.webhooks
  add column quiet_hours boolean not null default true;
