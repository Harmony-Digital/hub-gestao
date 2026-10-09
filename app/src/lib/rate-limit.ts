/**
 * Limite de pedidos por chave (PRD §8.3: 600 por minuto por padrão), em memória.
 * O Hub roda em um contêiner só na v1, então um balde de fichas por processo basta.
 */
export class RateLimiter {
  private readonly buckets = new Map<
    string,
    { tokens: number; updatedAt: number }
  >();

  constructor(
    private readonly limit = 600,
    private readonly windowMs = 60_000,
  ) {}

  /** Consome uma ficha. Sem ficha, devolve em quantos segundos tentar de novo. */
  take(
    key: string,
    now = Date.now(),
  ): { ok: true } | { ok: false; retryAfter: number } {
    const rate = this.limit / this.windowMs;
    const bucket = this.buckets.get(key) ?? {
      tokens: this.limit,
      updatedAt: now,
    };
    const tokens = Math.min(
      this.limit,
      bucket.tokens + (now - bucket.updatedAt) * rate,
    );
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return { ok: false, retryAfter: Math.ceil((1 - tokens) / rate / 1000) };
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    if (this.buckets.size > 10_000) this.sweep(now);
    return { ok: true };
  }

  /** Remove baldes cheios há mais de uma janela, para a memória não crescer. */
  private sweep(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > this.windowMs) this.buckets.delete(key);
    }
  }
}
