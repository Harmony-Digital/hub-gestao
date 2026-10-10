import { AGENT_ROLE } from "@/lib/labels";

/**
 * Papéis do catálogo (AGENTES.md) que o agente cumpre: o Concierge é o agente com o papel
 * CO-10, e um agente com chave só age nos papéis marcados aqui. O marcador escondido diz
 * ao servidor que o campo veio no formulário (sem ele, os papéis não mudam). Papel que
 * não está no catálogo, mas o agente já tem, continua aparecendo, para não sumir ao salvar.
 */
export function RolesField({ roles = [] }: { roles?: string[] }) {
  const codes = [...new Set([...Object.keys(AGENT_ROLE), ...roles])];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-sm font-medium text-navy">
        Papéis do catálogo (opcional)
      </legend>
      <p className="text-xs text-caption">
        O que este agente faz, pelos códigos de AGENTES.md. O Concierge da barra
        ⌘K é o agente com o papel CO-10.
      </p>
      <input type="hidden" name="roles_presentes" value="1" />
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {codes.map((code) => (
          <label
            key={code}
            className="flex min-w-0 items-center gap-2 text-sm text-ink"
          >
            <input
              type="checkbox"
              name="roles"
              value={code}
              defaultChecked={roles.includes(code)}
              className="size-4 shrink-0 accent-brand"
            />
            <span className="font-mono text-xs text-ink-2">{code}</span>
            <span className="truncate">
              {AGENT_ROLE[code] ?? "fora do catálogo"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
