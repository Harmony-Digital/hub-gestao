/**
 * Leitura do formulário de importação do plan.md (puro: vale na tela e nos testes). Quem
 * decide o que entra continua sendo o núcleo (modules/sync/service, importPlan).
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const CODE = /^[A-Z0-9]{2,8}$/;
export const IMPORT_MAX = 1_000_000;

export type ImportForm = {
  project: string;
  markdown: string;
  /** "preview": mostra o que entra e não grava; "import": grava. */
  intent: "preview" | "import";
  /** Modelo de onde veio o esqueleto (RF-36): os textos para o cliente entram depois. */
  template: string | null;
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function parseImportForm(form: FormData): Parsed<ImportForm> {
  const project = text(form, "project");
  if (!CODE.test(project)) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  // O envio da ação vai em multipart, que troca toda quebra de linha por \r\n (regra
  // da codificação); o campo de texto do navegador só tem \n. Volta para \n, senão o
  // arquivo devolvido sairia com quebras diferentes das do repositório.
  const markdown = text(form, "markdown").replace(/\r\n?/g, "\n");
  if (!markdown.trim()) {
    return {
      ok: false,
      message: "Cole o conteúdo do plan.md ou escolha o arquivo.",
    };
  }
  if (markdown.length > IMPORT_MAX) {
    return { ok: false, message: "O plan.md tem até 1 milhão de caracteres." };
  }
  const intent = text(form, "intent") === "import" ? "import" : "preview";
  const template = text(form, "modelo");
  return {
    ok: true,
    value: {
      project,
      markdown,
      intent,
      template:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          template,
        )
          ? template
          : null,
    },
  };
}
