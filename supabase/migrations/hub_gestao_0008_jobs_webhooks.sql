-- Hub de Gestão · 0008 · Ajustes para a fila de jobs e os webhooks de saída
-- 1. O segredo do webhook precisa ser recuperável para assinar cada entrega (HMAC);
--    por isso fica cifrado (AES-256-GCM com HUB_ENCRYPTION_KEY), não em hash.
-- 2. Jobs periódicos ganham uma chave de deduplicação: o mesmo job não entra duas vezes
--    na fila enquanto estiver esperando ou rodando.
-- 3. Índice para achar rápido as entregas de webhook pendentes.

alter table proj_hub_gestao.webhooks rename column secret_hash to secret_ciphertext;
comment on column proj_hub_gestao.webhooks.secret_ciphertext is
  'Segredo do webhook cifrado com AES-256-GCM (HUB_ENCRYPTION_KEY); usado para assinar as entregas.';

alter table proj_hub_gestao.jobs
  add column dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200);
create unique index jobs_dedupe_active_idx
  on proj_hub_gestao.jobs (workspace_id, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

create index webhook_deliveries_pending_idx
  on proj_hub_gestao.webhook_deliveries (next_attempt_at)
  where delivered_at is null;
