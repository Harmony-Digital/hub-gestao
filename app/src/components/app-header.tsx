import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { sair } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { WorkspaceRole } from "@/lib/db/actor";
import { NavLinks } from "./nav-links";

const roleLabel: Record<WorkspaceRole, string> = {
  owner: "Dono",
  admin: "Administração",
  member: "Equipe",
};

/** Cabeçalho das telas internas. Quem está logado aparece depois de conferir a sessão. */
export function AppHeader() {
  return (
    <header className="bg-navy text-mist">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" aria-label="Início do Hub" className="shrink-0">
            <Image
              src="/brand/harmony-logo-branco.png"
              alt="Harmony Digital"
              width={140}
              height={40}
              priority
              className="h-8 w-auto"
            />
          </Link>
          <NavLinks />
        </div>
        <Suspense fallback={<div className="h-9" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-off sm:inline">{user.fullName}</span>
      <span className="rounded-full border border-brand/40 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-brand-soft uppercase">
        {roleLabel[user.actor.role]}
      </span>
      <form action={sair}>
        <Button
          type="submit"
          variant="ghost"
          size="lg"
          className="text-mist hover:bg-navy-4 hover:text-off"
        >
          <LogOut aria-hidden="true" />
          Sair
        </Button>
      </form>
    </div>
  );
}
