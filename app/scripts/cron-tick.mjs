// Relógio dos jobs na VPS: o timer systemd roda
//   docker exec hub-app node /app/scripts/cron-tick.mjs
// a cada 5 minutos. Usa o CRON_SECRET do próprio contêiner e nunca o imprime.

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET ausente no contêiner.");
  process.exit(2);
}

const response = await fetch("http://127.0.0.1:3000/api/internal/cron/tick", {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(240_000),
});
const body = await response.text();

if (!response.ok) {
  console.error(`O relógio respondeu ${response.status}.`);
  console.error(body.slice(0, 500));
  process.exit(1);
}

const result = JSON.parse(body);
console.log(
  JSON.stringify({
    enqueued: result.enqueued ?? [],
    ran: (result.ran ?? []).map((job) => ({
      type: job.type,
      status: job.status,
    })),
  }),
);
