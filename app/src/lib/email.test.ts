import { describe, expect, it } from "vitest";
import {
  EMAIL_OFF,
  emailConfig,
  fromHeader,
  sendEmail,
  type EmailConfig,
} from "./email";

const CONFIG: EmailConfig = {
  apiKey: "re_teste_123",
  from: "hub@exemplo.com.br",
  replyTo: "contato@exemplo.com.br",
};

const message = {
  to: "pessoa@cliente.test",
  subject: "Seu acesso ao portal",
  text: "Olá! Entre por este link.",
};

function recorder(status = 200, body: unknown = { id: "email-1" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFake = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFake };
}

describe("e-mail pelo Resend", () => {
  it("lê a configuração só com a chave e o remetente", () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(
      emailConfig({
        RESEND_API_KEY: " re_x ",
        HUB_EMAIL_FROM: " Hub <a@b.c> ",
      }),
    ).toEqual({ apiKey: "re_x", from: "Hub <a@b.c>", replyTo: null });
  });

  it("desligado, não chama o provedor e diz o motivo", async () => {
    const { calls, fetchFake } = recorder();
    expect(
      await sendEmail(message, { config: null, fetch: fetchFake }),
    ).toEqual({
      ok: false,
      reason: "off",
      detail: EMAIL_OFF,
    });
    expect(calls).toHaveLength(0);
  });

  it("recusa destinatário, assunto ou texto inválidos sem chamar o provedor", async () => {
    const { calls, fetchFake } = recorder();
    const send = (patch: Partial<typeof message>) =>
      sendEmail({ ...message, ...patch }, { config: CONFIG, fetch: fetchFake });
    expect((await send({ to: "sem-arroba" })).ok).toBe(false);
    expect((await send({ to: "a@b.c, outro@d.e" })).ok).toBe(false);
    expect((await send({ subject: "linha\nquebrada" })).ok).toBe(false);
    expect((await send({ text: "   " })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("envia só texto, para um destinatário, com a chave de repetição", async () => {
    const { calls, fetchFake } = recorder(200, { id: "abc-123" });
    expect(
      await sendEmail(
        { ...message, idempotencyKey: "convite-1", fromName: "Agência Teste" },
        { config: CONFIG, fetch: fetchFake },
      ),
    ).toEqual({ ok: true, id: "abc-123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      authorization: "Bearer re_teste_123",
      "content-type": "application/json",
      "idempotency-key": "convite-1",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "Agência Teste <hub@exemplo.com.br>",
      to: ["pessoa@cliente.test"],
      subject: "Seu acesso ao portal",
      text: "Olá! Entre por este link.",
      reply_to: "contato@exemplo.com.br",
    });
  });

  it("recusa do provedor e provedor fora do ar viram motivo, sem lançar erro", async () => {
    const refused = recorder(422, { message: "domínio não verificado" });
    expect(
      await sendEmail(message, { config: CONFIG, fetch: refused.fetchFake }),
    ).toMatchObject({
      ok: false,
      reason: "provider",
      detail: expect.stringContaining("422"),
    });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(
      await sendEmail(message, { config: CONFIG, fetch: down }),
    ).toMatchObject({
      ok: false,
      reason: "provider",
    });
  });

  it("monta o remetente com o nome do workspace, sem deixar o nome quebrar o cabeçalho", () => {
    expect(fromHeader("hub@a.com", "Harmony Digital")).toBe(
      "Harmony Digital <hub@a.com>",
    );
    expect(fromHeader("hub@a.com", 'Nome "x" <y>\nZ')).toBe(
      "Nome x yZ <hub@a.com>",
    );
    expect(fromHeader("hub@a.com")).toBe("hub@a.com");
    expect(fromHeader("Outro <hub@a.com>", "Harmony")).toBe(
      "Outro <hub@a.com>",
    );
  });
});
