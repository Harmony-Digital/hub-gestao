const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z][A-Z0-9]{1,9}$/;

export type ReportForm = {
  project: string;
  start: string;
  end: string;
  audience: "client" | "internal";
  body: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * Lê o formulário de Preparar relatório. Para montar o resumo, o texto é opcional; para
 * mandar para aprovação, é obrigatório (`needBody`).
 */
export function parseReportForm(
  form: FormData,
  { needBody }: { needBody: boolean },
): Parsed<ReportForm> {
  const project = text(form, "project").trim().toUpperCase();
  if (!CODE.test(project)) {
    return { ok: false, message: "Escolha o projeto." };
  }
  const start = text(form, "start");
  const end = text(form, "end");
  if (!DATE.test(start) || !DATE.test(end)) {
    return { ok: false, message: "Informe o início e o fim do período." };
  }
  if (end < start) {
    return {
      ok: false,
      message: "O fim do período não pode ser antes do início.",
    };
  }
  const audienceRaw = text(form, "audience");
  if (audienceRaw !== "client" && audienceRaw !== "internal") {
    return { ok: false, message: "Escolha para quem é o relatório." };
  }
  const body = text(form, "body").trim();
  if (needBody && !body) {
    return {
      ok: false,
      message: "Escreva o relatório ou clique em Montar o resumo.",
    };
  }
  if (body.length > 20000) {
    return { ok: false, message: "O relatório passou de 20 mil caracteres." };
  }
  return {
    ok: true,
    value: { project, start, end, audience: audienceRaw, body },
  };
}
