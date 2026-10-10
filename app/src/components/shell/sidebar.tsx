import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { sair } from "@/app/login/actions";
import { initials } from "@/lib/format";
import { HEALTH, ROLE_LABEL } from "@/lib/labels";
import { getShell } from "@/lib/ui-context";
import { MenuToggle } from "./menu-toggle";
import { NAV_ITEMS, NAV_LINK_CLASS, NAV_LINK_IDLE } from "./nav-items";
import { ShellActions } from "./shell-actions";
import { SidebarNav } from "./sidebar-nav";

/**
 * Barra lateral das telas internas (protótipo "Hoje"): azul-marinho, links com o item
 * atual em laranja, decisões pendentes no Hoje, projetos em destaque e quem está logado.
 * O que depende da sessão chega depois do resto, sem segurar a tela.
 */
export function Sidebar() {
  return (
    <div className="flex min-h-full flex-col gap-5 bg-navy px-3.5 py-5 text-mist">
      <div className="hub-centro flex items-center justify-between gap-2 px-1.5">
        <Link href="/" aria-label="Hoje no Hub" className="hub-so-aberto">
          <Image
            src="/brand/harmony-logo-branco.png"
            alt="Harmony Digital"
            width={120}
            height={34}
            loading="eager"
            className="h-[30px] w-auto"
          />
        </Link>
        <span className="hub-so-aberto ml-auto rounded-full border border-brand/45 px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-brand-soft uppercase">
          Hub
        </span>
        <MenuToggle />
      </div>

      <ShellActions />

      <Suspense fallback={<NavPlaceholder />}>
        <NavWithCounts />
      </Suspense>

      <Suspense fallback={null}>
        <Featured />
      </Suspense>

      <div className="mt-auto">
        <Suspense fallback={<div className="h-16 rounded-xl bg-navy-2" />}>
          <UserCard />
        </Suspense>
      </div>
    </div>
  );
}

/** Enquanto a sessão é conferida: os mesmos links, sem destacar a tela atual. */
function NavPlaceholder() {
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`${NAV_LINK_CLASS} ${NAV_LINK_IDLE}`}
        >
          <Icon aria-hidden="true" className="size-[18px] shrink-0" />
          <span className="hub-rotulo flex-1">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

async function NavWithCounts() {
  const { data } = await getShell();
  return (
    <SidebarNav
      badges={{
        "/": {
          n: data.pendingDecisions,
          label: `${data.pendingDecisions} decisões esperando você`,
        },
        "/caixa-de-entrada": {
          n: data.unread,
          label: `${data.unread} avisos sem ler`,
        },
      }}
    />
  );
}

async function Featured() {
  const { data } = await getShell();
  return (
    <div className="hub-so-aberto flex flex-col gap-3">
      {data.featured.length > 0 ? (
        <section aria-labelledby="destaque" className="flex flex-col gap-1">
          <h2
            id="destaque"
            className="px-3 font-mono text-[10px] tracking-[0.12em] text-mist-2 uppercase"
          >
            Projetos em destaque
          </h2>
          <ul className="flex flex-col">
            {data.featured.map((p) => {
              const health = HEALTH[p.health as keyof typeof HEALTH];
              return (
                <li key={p.code}>
                  <Link
                    href={`/projetos/${p.code}`}
                    className="flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm text-mist hover:bg-navy-2 hover:text-off"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 shrink-0 rounded-full ${
                        p.health === "at_risk"
                          ? "bg-danger"
                          : p.health === "attention"
                            ? "bg-warn"
                            : "bg-ok"
                      }`}
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="sr-only">({health?.label})</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p className="flex items-center gap-2 px-3 text-xs text-mist-2">
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${data.agentsActive24h > 0 ? "bg-ok" : "bg-mist-2"}`}
        />
        {data.agentsActive24h === 0
          ? "Nenhum agente ativo nas últimas 24 h"
          : data.agentsActive24h === 1
            ? "1 agente ativo nas últimas 24 h"
            : `${data.agentsActive24h} agentes ativos nas últimas 24 h`}
      </p>
    </div>
  );
}

async function UserCard() {
  const { user } = await getShell();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-off/10 bg-navy-2 p-2.5">
      <Link
        href="/conta"
        className="hub-centro flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-navy-4"
        aria-label={`Minha conta: ${user.fullName}`}
        title={user.fullName}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-xs font-semibold text-navy">
          {initials(user.fullName)}
        </span>
        <span className="hub-so-aberto flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-off">
            {user.fullName}
          </span>
          <span className="truncate text-xs text-mist-2">
            {ROLE_LABEL[user.actor.role]} · Harmony Digital
          </span>
        </span>
      </Link>
      <form action={sair} className="hub-so-aberto">
        <button
          type="submit"
          title="Sair"
          className="inline-flex size-9 items-center justify-center rounded-lg text-mist hover:bg-navy-4 hover:text-off"
        >
          <LogOut aria-hidden="true" className="size-4" />
          <span className="sr-only">Sair</span>
        </button>
      </form>
    </div>
  );
}
