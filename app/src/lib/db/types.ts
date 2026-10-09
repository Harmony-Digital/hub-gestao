export type Row = Record<string, unknown>;

/** O mínimo que o domínio usa: SQL com parâmetros posicionais ($1, $2...). */
export interface Queryable {
  query<T extends Row = Row>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /**
   * Papel do Postgres assumido em cada transação (SET LOCAL ROLE). Usado no banco local
   * e nos testes para que as regras de acesso (RLS) valham também ali. Em produção, o app
   * conecta direto com o papel próprio dele e este campo fica vazio.
   */
  readonly runtimeRole?: string;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
