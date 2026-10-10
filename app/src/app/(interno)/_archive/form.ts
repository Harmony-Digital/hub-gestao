/**
 * Pedido de arquivar ou restaurar (marco, frente, projeto ou cliente): leitura do que
 * chega do navegador. Sem dependências de servidor, para valer na tela e nos testes.
 */

export const ARCHIVE_ENTITIES = [
  "milestone",
  "workstream",
  "project",
  "client",
] as const;
export type ArchiveEntity = (typeof ARCHIVE_ENTITIES)[number];

export type ArchiveRequest = {
  entity: ArchiveEntity;
  /** Código do projeto (CLI) ou id do marco, da frente ou do cliente. */
  ref: string;
  restore: boolean;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{2,8}$/;
const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function parseArchiveForm(form: FormData): Parsed<ArchiveRequest> {
  const entity = text(form, "entity");
  const ref = text(form, "ref");
  const mode = text(form, "mode");
  if (
    !(ARCHIVE_ENTITIES as readonly string[]).includes(entity) ||
    (mode !== "archive" && mode !== "restore")
  ) {
    return { ok: false, message: RELOAD };
  }
  const valid = entity === "project" ? CODE.test(ref) : UUID.test(ref);
  if (!valid) return { ok: false, message: RELOAD };
  return {
    ok: true,
    value: {
      entity: entity as ArchiveEntity,
      ref,
      restore: mode === "restore",
    },
  };
}
