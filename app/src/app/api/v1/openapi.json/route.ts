import { connection } from "next/server";
import { serverEnv } from "@/lib/env";
import { buildOpenApi } from "@/lib/http/contract";

/** Contrato OpenAPI 3.1 da API v1. Público: descreve a API, sem dados. */
export async function GET() {
  await connection();
  return Response.json(buildOpenApi(serverEnv().appVersion), {
    headers: { "Cache-Control": "no-store" },
  });
}
