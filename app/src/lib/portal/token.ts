import { createHmac, randomBytes } from "node:crypto";
import { assertPepper } from "@/lib/agent-keys";

/**
 * Valores do acesso ao portal (link de uso único e sessão): 32 bytes aleatórios, em
 * base64url. No banco fica só o HMAC com o pepper do servidor (o mesmo das chaves de
 * agente); o valor em claro vai uma vez para o dono copiar, ou no cookie da sessão.
 */
export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Formato de um valor gerado acima (43 caracteres base64url). */
export const PORTAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashPortalToken(token: string, pepper: string): string {
  return createHmac("sha256", assertPepper(pepper))
    .update(`portal:${token}`)
    .digest("hex");
}
