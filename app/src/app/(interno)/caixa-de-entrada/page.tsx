import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  AtSign,
  Ban,
  Bell,
  CircleCheckBig,
  Cpu,
  MessagesSquare,
  ServerCog,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { FilterChip } from "@/components/shell/filter-chip";
import { PageHeader } from "@/components/shell/page-header";
import { formatMoment } from "@/lib/format";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  GROUP_LABEL,
  inbox,
  NOTIFICATION_GROUPS,
  notificationPrefs,
  type NotificationGroup,
} from "@/modules/notifications";
import { MarkAllButton, MarkReadButton, PrefsForm } from "./inbox-controls";

export const metadata: Metadata = { title: "Caixa de entrada" };

const ICON: Record<NotificationGroup, LucideIcon> = {
  mention: AtSign,
  assignment: UserRoundCheck,
  approval: CircleCheckBig,
  blocked: Ban,
  agents: Cpu,
  client: MessagesSquare,
  system: ServerCog,
};

export default function CaixaPage({
  searchParams,
}: PageProps<"/caixa-de-entrada">) {
  return (
    <>
      <PageHeader
        trail={[{ label: "Caixa de entrada" }]}
        title="Caixa de entrada"
        description="Menções, tarefas passadas para você, aprovações, bloqueios e mensagens dos clientes no portal. Abrir um aviso já marca como lido."
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-64 rounded-2xl bg-off-2" />
          }
        >
          <InboxView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function InboxView({
  searchParams,
}: Pick<PageProps<"/caixa-de-entrada">, "searchParams">) {
  const query = await searchParams;
  const showAll = query.todos === "1";
  const { ctx } = await pageContext();
  const { data, prefs } = await inTx(ctx, async (t) => ({
    data: await inbox(t, { unreadOnly: !showAll, limit: 100 }),
    prefs: await notificationPrefs(t),
  }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Quais avisos" className="flex flex-wrap gap-2">
          <FilterChip href="/caixa-de-entrada" active={!showAll}>
            Não lidos
            <span className="font-mono text-xs opacity-80">{data.unread}</span>
          </FilterChip>
          <FilterChip href="/caixa-de-entrada?todos=1" active={showAll}>
            Todos
          </FilterChip>
        </nav>
        {data.unread > 0 ? <MarkAllButton /> : null}
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-ink-2">
          {showAll
            ? "Nenhum aviso por aqui ainda."
            : "Tudo em dia: nenhum aviso sem ler."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
          {data.items.map((item) => {
            const Icon = item.group ? ICON[item.group] : Bell;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3"
              >
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${item.read ? "text-caption" : "text-brand-strong"}`}
                />
                <div className="min-w-48 flex-1">
                  <Link
                    href={`/caixa-de-entrada/${item.id}`}
                    prefetch={false}
                    className={`text-sm hover:underline ${item.read ? "text-ink-2" : "font-semibold text-navy"}`}
                  >
                    {item.text}
                  </Link>
                  {item.detail ? (
                    <p className="mt-0.5 text-sm break-words text-ink-2">
                      {item.detail}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-caption">
                    {formatMoment(item.created_at)}
                    {item.read ? " · lido" : ""}
                  </p>
                </div>
                {!item.read ? (
                  <MarkReadButton id={item.id} label={item.text} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <section
        aria-labelledby="preferencias-avisos"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
      >
        <h2
          id="preferencias-avisos"
          className="font-heading text-base font-semibold text-navy"
        >
          Avisos que você recebe
        </h2>
        <PrefsForm
          groups={NOTIFICATION_GROUPS.map((g) => ({
            key: g,
            label: GROUP_LABEL[g],
            enabled: prefs[g],
          }))}
        />
      </section>
    </>
  );
}
