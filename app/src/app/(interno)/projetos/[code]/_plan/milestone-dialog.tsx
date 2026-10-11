"use client";

import { useActionState, useId, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Eye,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Send,
  X,
} from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { MILESTONE_STATUS } from "@/lib/labels";
import { ArchiveConfirm } from "../../../_archive/archive-controls";
import { moverMarco, pedirAceite, salvarMarco } from "./actions";
import { MILESTONE_STATUSES } from "./form";

/** O marco como o formulário de edição precisa (só marcos ainda não aceitos). */
export type MilestoneInitial = {
  id: string;
  code: string;
  title: string;
  title_client: string | null;
  description_client: string | null;
  due_date: string | null;
  status: (typeof MILESTONE_STATUSES)[number];
  visibility: "internal" | "client";
  acceptance_criteria: { text: string; done: boolean }[];
  gate_required: boolean;
};

/** "Novo marco" (sem marco) ou "Editar" (com o marco), numa janela. */
export function MilestoneButton({
  projectCode,
  milestone,
  canDropGate = false,
}: {
  projectCode: string;
  milestone?: MilestoneInitial;
  /** Quem aceita marcos (o dono) pode tirar o GATE (RF-09, D9). */
  canDropGate?: boolean;
}) {
  return (
    <FormDialog
      label={milestone ? "Editar" : "Novo marco"}
      accessibleLabel={milestone ? `Editar ${milestone.code}` : undefined}
      icon={
        milestone ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />
      }
      variant={milestone ? "ghost" : "outline"}
      size={milestone ? "sm" : "lg"}
      title={
        milestone ? `Editar ${milestone.code}` : `Novo marco em ${projectCode}`
      }
      description={
        milestone
          ? milestone.title
          : "Uma entrega que o cliente reconhece. O aceite é decidido nas Aprovações."
      }
      wide
    >
      {(close) => (
        <MilestoneForm
          projectCode={projectCode}
          milestone={milestone}
          canDropGate={canDropGate}
          onDone={close}
        />
      )}
    </FormDialog>
  );
}

function MilestoneForm({
  projectCode,
  milestone,
  canDropGate,
  onDone,
}: {
  projectCode: string;
  milestone?: MilestoneInitial;
  canDropGate: boolean;
  onDone: () => void;
}) {
  const gate = milestone?.gate_required ?? true;
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarMarco(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  const [due, setDue] = useState(milestone?.due_date ?? "");
  // Linhas dos critérios com chave estável: a ordem dos nomes (criteria.N) é a da tela.
  const [rows, setRows] = useState(() =>
    (milestone?.acceptance_criteria ?? []).map((c, key) => ({ key, ...c })),
  );
  const [added, setAdded] = useState<number | null>(null);
  const addRow = () => {
    const key = (rows.at(-1)?.key ?? -1) + 1;
    setRows([...rows, { key, text: "", done: false }]);
    setAdded(key);
  };
  // Arquivar troca o formulário pela confirmação, na mesma janela; Voltar devolve o
  // formulário como estava.
  const [archiving, setArchiving] = useState(false);

  return (
    <>
      {milestone && archiving ? (
        <ArchiveConfirm
          target={{ entity: "milestone", ref: milestone.id }}
          question={`Arquivar o ${milestone.code}?`}
          consequence="O marco sai da Visão geral e do portal do cliente. Nada é apagado: dá para restaurar em “Marcos arquivados”, no fim da camada estratégica."
          confirmLabel="Arquivar o marco"
          onCancel={() => setArchiving(false)}
          onDone={onDone}
        />
      ) : null}
      <form
        onSubmit={submit}
        className={archiving ? "hidden" : "flex flex-col gap-4"}
      >
        <input type="hidden" name="project" value={projectCode} />
        {milestone ? (
          <input type="hidden" name="id" value={milestone.id} />
        ) : null}
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <Field
            id={`${id}-title`}
            label="Título do marco"
            hint="Como a equipe chama esta entrega."
          >
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={200}
              autoFocus
              defaultValue={milestone?.title ?? ""}
              placeholder="Ex.: Agente de atendimento no ar"
              className={inputClass}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${id}-status`} label="Status">
              <select
                id={`${id}-status`}
                name="status"
                defaultValue={milestone?.status ?? "planned"}
                className={inputClass}
              >
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MILESTONE_STATUS[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-due`} label="Data prevista">
              <input
                id={`${id}-due`}
                type="date"
                name="due_date"
                defaultValue={milestone?.due_date ?? ""}
                onChange={(event) => setDue(event.currentTarget.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {milestone && due !== (milestone.due_date ?? "") ? (
            <Field
              id={`${id}-reason`}
              label="Por que a data mudou? (opcional)"
              hint="Fica no histórico de datas do marco. Só a equipe vê."
            >
              <textarea
                id={`${id}-reason`}
                name="date_reason"
                rows={2}
                maxLength={500}
                className={textareaClass}
              />
            </Field>
          ) : null}

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-medium text-navy">
              Critérios de aceite
            </legend>
            <p className="text-xs text-caption">
              O que precisa estar pronto para o marco ser aceito. Marque o que
              já foi cumprido.
            </p>
            {rows.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name={`criteria.${row.key}.done`}
                      defaultChecked={row.done}
                      aria-label={`Critério ${i + 1} cumprido`}
                      className="size-4 shrink-0 accent-[var(--color-brand)]"
                    />
                    <input
                      name={`criteria.${row.key}.text`}
                      defaultValue={row.text}
                      maxLength={300}
                      autoFocus={row.key === added}
                      aria-label={`Critério ${i + 1}`}
                      placeholder="Ex.: o agente responde em até 1 minuto"
                      className={inputClass}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover o critério ${i + 1}`}
                      onClick={() =>
                        setRows(rows.filter((r) => r.key !== row.key))
                      }
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={rows.length >= 30}
              onClick={addRow}
            >
              <Plus aria-hidden="true" />
              Adicionar critério
            </Button>
          </fieldset>

          <div className="flex flex-col gap-1">
            <input type="hidden" name="gate_section" value="1" />
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="gate_required"
                defaultChecked={gate}
                // Com GATE, só o dono tira; sem GATE, quem edita pode pôr de volta.
                disabled={gate && !canDropGate}
                aria-describedby={`${id}-gate-hint`}
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              <span className="flex items-center gap-1.5">
                <Lock aria-hidden="true" className="size-3.5 text-caption" />
                Exige o aceite do dono (GATE)
              </span>
            </label>
            {gate && !canDropGate ? (
              // A caixa desabilitada não vai no formulário: o valor segue por aqui.
              <input type="hidden" name="gate_required" value="on" />
            ) : null}
            <p id={`${id}-gate-hint`} className="text-xs text-caption">
              {gate && !canDropGate
                ? "Com o GATE, o marco fecha com o aceite pedido nas Aprovações. Só o dono tira o GATE."
                : "Com o GATE, o marco fecha com o aceite pedido nas Aprovações. Sem o GATE, basta marcar como Entregue."}
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-xl bg-off p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-navy">
              <Eye aria-hidden="true" className="size-4" />O que o cliente vê
            </p>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="client_visible"
                defaultChecked={
                  milestone ? milestone.visibility === "client" : true
                }
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              O cliente vê este marco no portal.
            </label>
            <Field
              id={`${id}-title-client`}
              label="Título para o cliente"
              hint="O portal mostra só o que estiver escrito aqui, nunca o título interno."
            >
              <input
                id={`${id}-title-client`}
                name="title_client"
                maxLength={200}
                defaultValue={milestone?.title_client ?? ""}
                className={inputClass}
              />
            </Field>
            <Field
              id={`${id}-description-client`}
              label="Descrição para o cliente (opcional)"
            >
              <textarea
                id={`${id}-description-client`}
                name="description_client"
                rows={2}
                maxLength={2000}
                defaultValue={milestone?.description_client ?? ""}
                className={textareaClass}
              />
            </Field>
          </div>
        </fieldset>

        <div aria-live="polite">
          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {milestone ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={pending}
              className="mr-auto text-danger-fg"
              onClick={() => setArchiving(true)}
            >
              <Archive aria-hidden="true" />
              Arquivar
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={onDone}
          >
            Cancelar
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            {milestone ? "Salvar o marco" : "Criar marco"}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Subir e Descer: a ordem dos marcos na Visão geral, no portal e no plan.md (RF-09). */
export function MilestoneOrder({
  milestone,
  first,
  last,
}: {
  milestone: { id: string; code: string };
  first: boolean;
  last: boolean;
}) {
  const [state, action, pending] = useActionState(moverMarco, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end">
      <input type="hidden" name="id" value={milestone.id} />
      <span className="flex items-center">
        <Button
          type="submit"
          name="direction"
          value="up"
          variant="ghost"
          size="icon-sm"
          disabled={pending || first}
          aria-label={`Subir o ${milestone.code}`}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          name="direction"
          value="down"
          variant="ghost"
          size="icon-sm"
          disabled={pending || last}
          aria-label={`Descer o ${milestone.code}`}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      </span>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** "Pedir aceite": confirma e manda o pedido para as Aprovações. */
export function RequestAcceptanceButton({
  milestone,
}: {
  milestone: {
    id: string;
    code: string;
    title: string;
    criteriaDone: number;
    criteriaTotal: number;
  };
}) {
  return (
    <FormDialog
      label="Pedir aceite"
      accessibleLabel={`Pedir aceite do ${milestone.code}`}
      icon={<Send aria-hidden="true" />}
      size="sm"
      title={`Pedir o aceite do ${milestone.code}`}
      description={milestone.title}
    >
      {(close) => <AcceptanceForm milestone={milestone} onDone={close} />}
    </FormDialog>
  );
}

function AcceptanceForm({
  milestone,
  onDone,
}: {
  milestone: Parameters<typeof RequestAcceptanceButton>[0]["milestone"];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await pedirAceite(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={milestone.id} />
      <p className="text-sm text-ink">
        O pedido vai para a tela Aprovações, onde o aceite é decidido. Aceito, o
        marco não muda mais.
      </p>
      <p className="text-sm text-ink-2">
        {milestone.criteriaTotal === 0
          ? "Este marco não tem critérios de aceite cadastrados."
          : `Critérios cumpridos: ${milestone.criteriaDone} de ${milestone.criteriaTotal}.`}
      </p>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending} autoFocus>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Pedir o aceite
        </Button>
      </div>
    </form>
  );
}
