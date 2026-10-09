import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

/**
 * Cifra simétrica para segredos guardados no banco (credenciais de IA, D5, e segredos de
 * webhook): AES-256-GCM com HUB_ENCRYPTION_KEY (32 bytes em base64 ou hex).
 * Formato: v1.<iv>.<tag>.<cifrado>, tudo em base64url.
 */

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("HUB_ENCRYPTION_KEY ausente.");
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      "HUB_ENCRYPTION_KEY precisa ter 32 bytes (base64 ou 64 caracteres hex).",
    );
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) {
    throw new Error("Segredo cifrado em formato desconhecido.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Assinatura das entregas de webhook: sha256=<hex> sobre "<timestamp>.<corpo>". */
export function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return (
    "sha256=" +
    createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
  );
}
