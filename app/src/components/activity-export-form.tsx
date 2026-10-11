import { Download } from "lucide-react";
import { Field, inputClass } from "@/components/forms";
import { Button } from "@/components/ui/button";

/**
 * Exportar a atividade por período (RF-43): formulário simples (GET), que baixa o CSV ou
 * o JSON pela rota /atividade/exportar, sem sair da tela. Sem projeto, exporta todos
 * (dono e administração; a rota confere).
 */
export function ActivityExportForm({
  project,
  today,
}: {
  project: string | null;
  /** Hoje (AAAA-MM-DD): o período padrão vai do dia 1 do mês até hoje. */
  today: string;
}) {
  const prefix = project ?? "todos";
  return (
    <form
      method="get"
      action="/atividade/exportar"
      className="flex flex-wrap items-end gap-3"
    >
      {project ? <input type="hidden" name="projeto" value={project} /> : null}
      <Field id={`atividade-${prefix}-de`} label="De">
        <input
          id={`atividade-${prefix}-de`}
          type="date"
          name="de"
          required
          defaultValue={`${today.slice(0, 8)}01`}
          max={today}
          className={inputClass}
        />
      </Field>
      <Field id={`atividade-${prefix}-ate`} label="Até">
        <input
          id={`atividade-${prefix}-ate`}
          type="date"
          name="ate"
          required
          defaultValue={today}
          max={today}
          className={inputClass}
        />
      </Field>
      <Field id={`atividade-${prefix}-formato`} label="Formato">
        <select
          id={`atividade-${prefix}-formato`}
          name="formato"
          defaultValue="csv"
          className={inputClass}
        >
          <option value="csv">CSV (planilha)</option>
          <option value="json">JSON</option>
        </select>
      </Field>
      <Button type="submit" variant="outline" size="lg">
        <Download aria-hidden="true" />
        Exportar
      </Button>
    </form>
  );
}
