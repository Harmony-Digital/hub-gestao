import { HubError, toHubError } from "@/lib/errors";
import type { TxCtx } from "@/modules/context";

export type Outcome<T> =
  { ok: true; value: T } | { ok: false; error: HubError };
let savepoints = 0;

/**
 * Roda um passo num ponto de salvamento da transação: se falhar com uma recusa do Hub
 * (erro 4xx), desfaz só ele e devolve o erro, sem perder o resto. Erro inesperado (5xx)
 * sobe e derruba a transação inteira. Usado pela sincronização do plan.md e pelo webhook
 * do GitHub, que aplicam vários itens de uma vez.
 */
export async function attempt<T>(
  t: TxCtx,
  fn: () => Promise<T>,
): Promise<Outcome<T>> {
  const name = `hub_step_${(savepoints = (savepoints + 1) % 1_000_000)}`;
  await t.tx.query(`savepoint ${name}`);
  try {
    const value = await fn();
    await t.tx.query(`release savepoint ${name}`);
    return { ok: true, value };
  } catch (raw) {
    await t.tx.query(`rollback to savepoint ${name}`);
    const error = toHubError(raw);
    if (error.status >= 500) throw raw;
    return { ok: false, error };
  }
}
