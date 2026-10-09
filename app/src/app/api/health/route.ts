import { connection } from "next/server";
import { buildHealth } from "@/lib/health";

// Com Cache Components, um GET sem dados de pedido seria pré-renderizado no build.
// connection() garante que a saúde é calculada a cada chamada (ver docs locais do Next.js).
export async function GET() {
  await connection();
  return Response.json(buildHealth(process.env, new Date()), {
    headers: { "Cache-Control": "no-store" },
  });
}
