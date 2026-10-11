"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CornerDownRight, Hourglass, LoaderCircle, X } from "lucide-react";
import { LabelChips } from "@/components/label-chips";
import { Avatar, Pill } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { formatDayMonth, initials } from "@/lib/format";
import { PRIORITY, STATUS_CATEGORY_TONE } from "@/lib/labels";
import { mudarStatus, reordenarColuna } from "./actions";
import {
  columnBeside,
  columnCodes,
  laneOf,
  needsNote,
  placeCard,
  type BoardCard,
  type BoardColumn,
  type LaneBy,
} from "./board-state";
import { IDLE, type ActionState } from "./form";
import { WaitingOnSelect } from "./waiting-on-select";
import type { AssigneeOption } from "@/modules/tasks/board";
import { ErrorNote, textareaClass } from "@/components/forms";
import { holdLive } from "../../../_live/hold";

/**
 * Alvos de soltar: a coluna (fim dela) ou um cartão (antes dele). Ids com "|" porque o
 * código da raia pode ter ":" (responsável "user:<id>").
 */
const COL = "col|";
const CARD = "card|";
const colId = (lane: string, statusId: string) => `${COL}${lane}|${statusId}`;
const cardId = (code: string) => `${CARD}${code}`;

type Target = { statusId: string; before: string | null };

/** Pedido de texto ao soltar em Concluída (evidência) ou Bloqueada (motivo). */
type NoteRequest = {
  card: BoardCard;
  column: BoardColumn;
  before: string | null;
};

// Com o mouse, vale o ponteiro; no teclado não há ponteiro, então vale a área do cartão.
// Sobre um cartão, ele é o alvo (soltar antes dele); senão, a coluna.
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const hits = within.length > 0 ? within : rectIntersection(args);
  const self = cardId(String(args.active.id));
  const onCards = hits.filter(
    (h) => String(h.id).startsWith(CARD) && String(h.id) !== self,
  );
  return onCards.length > 0
    ? onCards
    : hits.filter((h) => String(h.id).startsWith(COL));
};

/** Setas para os lados levam o cartão à coluna vizinha; para cima e para baixo, andam. */
const keyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;
  if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
    event.preventDefault();
    const spans = droppableContainers
      .getEnabled()
      .filter((container) => String(container.id).startsWith(COL))
      .flatMap((container) => {
        const rect = droppableRects.get(container.id);
        return rect
          ? [{ id: String(container.id), left: rect.left, width: rect.width }]
          : [];
      });
    const target = columnBeside(
      spans,
      collisionRect.left + collisionRect.width / 2,
      event.code === "ArrowRight" ? 1 : -1,
    );
    if (!target) return undefined;
    return {
      x: target.left + (target.width - collisionRect.width) / 2,
      y: currentCoordinates.y,
    };
  }
  if (event.code === "ArrowDown" || event.code === "ArrowUp") {
    event.preventDefault();
    return {
      ...currentCoordinates,
      y: currentCoordinates.y + (event.code === "ArrowDown" ? 48 : -48),
    };
  }
  return undefined;
};

function readTarget(id: string | undefined, cards: BoardCard[]): Target | null {
  if (!id) return null;
  if (id.startsWith(CARD)) {
    const code = id.slice(CARD.length);
    const over = cards.find((c) => c.code === code);
    return over ? { statusId: over.statusId, before: over.code } : null;
  }
  if (id.startsWith(COL)) {
    return { statusId: id.slice(id.lastIndexOf("|") + 1), before: null };
  }
  return null;
}

export function KanbanBoard({
  projectCode,
  columns,
  cards: serverCards,
  lanes,
  laneBy,
  assignees = [],
}: {
  projectCode: string;
  columns: BoardColumn[];
  /** Pessoas e agentes para "quem destrava", ao soltar em Bloqueada. */
  assignees?: AssigneeOption[];
  /** Já na ordem do quadro (posição manual, depois a do servidor). */
  cards: BoardCard[];
  /** Raias (frente ou responsável), ou null para o quadro único. */
  lanes: { key: string; label: string }[] | null;
  laneBy: LaneBy | null;
}) {
  const router = useRouter();
  const [cards, applyPlace] = useOptimistic(
    serverCards,
    (state, move: { code: string; statusId: string; before: string | null }) =>
      placeCard(state, move.code, move.statusId, move.before),
  );
  const [saving, startSaving] = useTransition();
  const [active, setActive] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<NoteRequest | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Soltar o cartão no mesmo lugar não pode virar clique (abrir o painel).
  const justDragged = useRef(false);
  // Durante o arraste, a atualização ao vivo espera (a tela não muda debaixo do cartão).
  const liveHold = useRef<(() => void) | null>(null);
  useEffect(() => () => liveHold.current?.(), []);
  const activeLane = active && laneBy ? laneOf(active, laneBy) : null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // No celular, arrastar pede um toque longo; o toque curto abre a tarefa e rolar
    // continua rolando.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
      coordinateGetter: keyboardCoordinates,
    }),
  );

  const columnName = useMemo(
    () => new Map(columns.map((c) => [c.id, c.name])),
    [columns],
  );
  const describe = (id: string | undefined) => {
    const target = readTarget(id, cards);
    if (!target) return "fora das colunas";
    const name = columnName.get(target.statusId) ?? "";
    return target.before
      ? `antes de ${target.before}, na coluna ${name}`
      : `no fim da coluna ${name}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Tarefa ${active.id} pega. Setas para os lados trocam de coluna; para cima e para baixo, de lugar. Espaço solta.`,
    onDragOver: ({ active, over }) =>
      `Tarefa ${active.id} ${describe(over ? String(over.id) : undefined)}.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Tarefa ${active.id} solta ${describe(String(over.id))}.`
        : `Tarefa ${active.id} solta fora das colunas. Nada mudou.`,
    onDragCancel: ({ active }) =>
      `Movimento da tarefa ${active.id} cancelado. Nada mudou.`,
  };

  /** Grava a ordem da coluna, se ela tiver mais de um cartão. */
  async function saveOrder(codes: string[]): Promise<ActionState> {
    if (codes.length < 2) return { status: "ok" };
    const form = new FormData();
    form.set("project", projectCode);
    form.set("codes", codes.join(","));
    return reordenarColuna(IDLE, form);
  }

  /** Muda o status (com evidência ou motivo, se pedido) e grava a ordem da coluna. */
  function save(
    card: BoardCard,
    column: BoardColumn,
    before: string | null,
    text?: string,
    waitingOn?: string,
  ): Promise<ActionState> {
    const codes = columnCodes(
      placeCard(cards, card.code, column.id, before),
      column.id,
    );
    return new Promise((resolve) => {
      startSaving(async () => {
        const done = holdLive();
        try {
          applyPlace({ code: card.code, statusId: column.id, before });
          if (card.statusId !== column.id) {
            const form = new FormData();
            form.set("code", card.code);
            form.set("version", String(card.version));
            form.set("status_id", column.id);
            if (text) {
              form.set(
                column.category === "done" ? "evidence" : "reason",
                text,
              );
            }
            if (waitingOn && column.category === "blocked") {
              form.set("waiting_on", waitingOn);
            }
            const moved = await mudarStatus(IDLE, form);
            if (moved.status === "error") return resolve(moved);
          }
          resolve(await saveOrder(codes));
        } finally {
          done();
        }
      });
    });
  }

  function release() {
    liveHold.current?.();
    liveHold.current = null;
    setActive(null);
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }

  function onDragStart(event: DragStartEvent) {
    liveHold.current?.();
    liveHold.current = holdLive();
    justDragged.current = true;
    setError(null);
    setActive(cards.find((c) => c.code === event.active.id) ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    release();
    const card = cards.find((c) => c.code === event.active.id);
    const target = readTarget(
      event.over ? String(event.over.id) : undefined,
      cards,
    );
    const column = columns.find((c) => c.id === target?.statusId);
    if (!card || !target || !column || target.before === card.code) return;
    if (card.statusId !== column.id && needsNote(column)) {
      setNoteError(null);
      setNote({ card, column, before: target.before });
      return;
    }
    const result = await save(card, column, target.before);
    if (result.status === "error") setError(result.message);
  }

  async function confirmNote(text: string, waitingOn?: string) {
    if (!note) return;
    setNoteError(null);
    const result = await save(
      note.card,
      note.column,
      note.before,
      text,
      waitingOn,
    );
    if (result.status === "error") setNoteError(result.message);
    else setNote(null);
  }

  function open(card: BoardCard) {
    if (justDragged.current) return;
    router.push(card.href, { scroll: false });
  }

  const row = (lane: string, laneCards: BoardCard[]) => (
    <div className="-mx-4 flex scroll-px-4 snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:scroll-px-8 sm:px-8">
      {columns.map((column) => (
        <Column
          key={column.id}
          lane={lane}
          column={column}
          cards={laneCards.filter((c) => c.statusId === column.id)}
          single={lanes === null}
          disabled={activeLane !== null && activeLane !== lane}
          onOpen={open}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" className="flex flex-col gap-2">
        {error ? (
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <ErrorNote message={error} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => setError(null)}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Fechar o aviso</span>
            </Button>
          </div>
        ) : null}
        {saving ? (
          <p className="flex items-center gap-2 text-xs text-caption">
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
            Salvando a mudança…
          </p>
        ) : null}
      </div>

      {/* Id fixo: o contador interno do dnd-kit difere entre servidor e navegador e
          quebraria a hidratação (aria-describedby). */}
      <DndContext
        id="quadro"
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover a tarefa, pressione espaço, use as setas (para os lados troca de coluna; para cima e para baixo, de lugar) e pressione espaço de novo para soltar. Esc cancela. Enter abre a tarefa.",
          },
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={release}
      >
        {lanes && laneBy ? (
          <div className="flex flex-col gap-4">
            {lanes.map((lane) => {
              const laneCards = cards.filter(
                (c) => laneOf(c, laneBy) === lane.key,
              );
              return (
                <section
                  key={lane.key}
                  aria-label={`Raia ${lane.label}`}
                  className="flex flex-col gap-2"
                >
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
                    {lane.label}
                    <span className="font-mono text-xs font-normal text-caption">
                      {laneCards.length}
                    </span>
                  </h3>
                  {row(lane.key, laneCards)}
                </section>
              );
            })}
          </div>
        ) : (
          row("all", cards)
        )}
        <DragOverlay dropAnimation={null}>
          {active ? <CardFace card={active} lifted /> : null}
        </DragOverlay>
      </DndContext>

      <NoteDialog
        request={note}
        error={noteError}
        pending={saving}
        assignees={assignees}
        onCancel={() => setNote(null)}
        onConfirm={confirmNote}
      />
    </div>
  );
}

function Column({
  lane,
  column,
  cards,
  single,
  disabled,
  onOpen,
}: {
  lane: string;
  column: BoardColumn;
  cards: BoardCard[];
  /** Quadro sem raias: a coluna mostra o total do status (e o aviso das concluídas). */
  single: boolean;
  disabled: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: colId(lane, column.id),
    disabled,
  });
  const total = single ? column.total : cards.length;
  const hidden = total - cards.length;
  const headingId = `coluna-${lane.replace(/[^a-z0-9-]/gi, "")}-${column.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex w-[min(85vw,18rem)] shrink-0 snap-start flex-col rounded-2xl border border-line bg-off-2/50 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <h2 id={headingId} className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Pill tone={STATUS_CATEGORY_TONE[column.category]}>
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ background: column.color }}
          />
          {column.name}
        </Pill>
        <span className="font-mono text-xs font-normal text-caption">
          {total}
        </span>
      </h2>
      <div
        ref={setNodeRef}
        className={`flex min-h-32 flex-1 flex-col gap-2 rounded-b-2xl px-2 pb-2 transition-colors ${
          isOver ? "bg-brand-soft/15 ring-2 ring-brand/40 ring-inset" : ""
        }`}
      >
        {cards.map((card) => (
          <DraggableCard
            key={card.code}
            card={card}
            disabled={disabled}
            onOpen={onOpen}
          />
        ))}
        {cards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-caption">
            Solte uma tarefa aqui
          </p>
        ) : null}
        {single && column.category === "done" && hidden > 0 ? (
          <p className="px-1 text-xs text-caption">
            Mostrando as {cards.length} mais recentes. As outras {hidden} estão
            na Lista.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  disabled,
  onOpen,
}: {
  card: BoardCard;
  disabled: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: card.code });
  // O cartão também é alvo: soltar outro em cima dele põe o outro antes deste.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: cardId(card.code),
    disabled,
  });
  const label = [
    `${card.code}: ${card.title}`,
    card.assignee ? `com ${card.assignee.name}` : null,
    card.due
      ? `prazo ${formatDayMonth(card.due)}${card.late ? ", atrasada" : ""}`
      : null,
    card.priority === "urgent" || card.priority === "high"
      ? `prioridade ${PRIORITY[card.priority].label.toLowerCase()}`
      : null,
    card.waitingOn.length > 0 ? `espera ${card.waitingOn.join(" e ")}` : null,
    card.labels.length > 0
      ? `etiquetas ${card.labels.map((l) => l.name).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      data-board-card=""
      aria-roledescription="tarefa arrastável"
      aria-label={label}
      onClick={() => onOpen(card)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Enter") {
          event.preventDefault();
          onOpen(card);
        }
      }}
      className={`cursor-grab rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-brand/50 active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      } ${isOver && !isDragging ? "shadow-[0_-3px_0_0_var(--color-brand)]" : ""}`}
    >
      <CardFace card={card} />
    </div>
  );
}

/** O cartão em si: leve, só o que ajuda a decidir a próxima ação. */
function CardFace({
  card,
  lifted = false,
}: {
  card: BoardCard;
  lifted?: boolean;
}) {
  const priority = PRIORITY[card.priority];
  return (
    <div
      aria-hidden={lifted || undefined}
      className={`flex flex-col gap-2 rounded-xl border border-line bg-card p-3 text-sm ${
        lifted
          ? "rotate-1 shadow-xl ring-2 ring-brand/40"
          : "shadow-sm hover:border-mist"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-caption">
          {card.code}
        </span>
        {card.parent ? (
          <span className="flex items-center gap-0.5 text-xs text-caption">
            <CornerDownRight aria-hidden="true" className="size-3" />
            {card.parent}
          </span>
        ) : null}
        <span className="ml-auto">
          {card.priority !== "normal" ? (
            <Pill tone={priority.tone}>{priority.label}</Pill>
          ) : null}
        </span>
      </div>
      <p
        className={`line-clamp-3 leading-snug ${
          card.done ? "text-ink-2 line-through decoration-mist" : "text-ink"
        }`}
      >
        {card.title}
      </p>
      {card.workstream ? (
        <p className="truncate text-xs text-ink-2">{card.workstream}</p>
      ) : null}
      <LabelChips labels={card.labels} />
      {card.waitingOn.length > 0 ? (
        <p className="flex items-center gap-1 text-xs font-medium text-warn-fg">
          <Hourglass aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">Espera {card.waitingOn.join(", ")}</span>
        </p>
      ) : null}
      {card.assignee || card.due ? (
        <div className="flex items-center gap-2 text-xs">
          {card.assignee ? (
            <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
              <Avatar
                text={initials(card.assignee.name)}
                agent={card.assignee.agent}
              />
              <span className="truncate">{card.assignee.name}</span>
            </span>
          ) : null}
          {card.due ? (
            <span
              className={`ml-auto shrink-0 ${
                card.late ? "font-semibold text-danger-fg" : "text-ink-2"
              }`}
            >
              {formatDayMonth(card.due)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NoteDialog({
  request,
  error,
  pending,
  assignees,
  onCancel,
  onConfirm,
}: {
  request: NoteRequest | null;
  error: string | null;
  pending: boolean;
  assignees: AssigneeOption[];
  onCancel: () => void;
  onConfirm: (text: string, waitingOn?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (request && !d.open) d.showModal();
    if (!request && d.open) d.close();
  }, [request]);

  const done = request?.column.category === "done";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = data.get("note");
    const waitingOn = data.get("waiting_on");
    if (typeof text === "string" && text.trim()) {
      onConfirm(
        text.trim(),
        typeof waitingOn === "string" && waitingOn ? waitingOn : undefined,
      );
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="quadro-nota-titulo"
      onClose={onCancel}
      className="m-auto w-[min(92vw,30rem)] max-w-none rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-navy-3/50"
    >
      {request ? (
        <form
          key={`${request.card.code}-${request.column.id}`}
          onSubmit={submit}
          className="flex flex-col gap-4 p-5 sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="quadro-nota-titulo"
              className="font-heading text-lg font-semibold text-navy"
            >
              {done
                ? `Concluir ${request.card.code}`
                : `Bloquear ${request.card.code}`}
            </h2>
            <p className="text-sm text-ink-2">{request.card.title}</p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {done ? "Evidência da entrega" : "O que falta e de quem depende"}
            <textarea
              name="note"
              required
              maxLength={2000}
              rows={3}
              autoFocus
              disabled={pending}
              placeholder={
                done
                  ? "Link, arquivo, commit ou o que comprova que está pronto."
                  : "Ex.: aguarda o acesso da agenda, que o cliente vai enviar."
              }
              className={textareaClass}
            />
          </label>
          {!done ? (
            <WaitingOnSelect
              id="quadro-quem-destrava"
              assignees={assignees}
              disabled={pending}
            />
          ) : null}
          <div aria-live="polite">
            {error ? <ErrorNote message={error} /> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending}
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              {done ? "Concluir a tarefa" : "Bloquear a tarefa"}
            </Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
