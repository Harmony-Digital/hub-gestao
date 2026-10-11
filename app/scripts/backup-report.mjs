// Aviso de backup que deu certo, chamado pelos scripts da VPS:
//   docker exec hub-app node /app/scripts/backup-report.mjs <local|offsite> <arquivo> <bytes>
// Usa o CRON_SECRET do próprio contêiner e nunca o imprime. Sem o aviso por mais de
// 30 horas, o Hub alerta o dono (docs/operacao.md, Alertas).

const [kind, file, bytes] = process.argv.slice(2);
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET ausente no contêiner.");
  process.exit(2);
}

const response = await fetch(
  "http://127.0.0.1:3000/api/internal/backups/report",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ kind, file, bytes: Number(bytes) }),
    signal: AbortSignal.timeout(30_000),
  },
);

if (!response.ok) {
  console.error(`O Hub respondeu ${response.status}.`);
  console.error((await response.text()).slice(0, 300));
  process.exit(1);
}
console.log(`O Hub registrou o backup (${kind}).`);
