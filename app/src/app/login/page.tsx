import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { authConfig, magicLinkEnabled } from "@/lib/auth/config";
import { loginErrorMessage, safeNextPath } from "@/lib/auth/next-path";
import { entrarLocal } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="flex flex-1 flex-col bg-navy">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/brand/harmony-logo-branco.png"
            alt="Harmony Digital"
            width={160}
            height={46}
            priority
            className="h-9 w-auto"
          />
          <p className="font-mono text-[11px] tracking-[0.12em] text-brand-soft uppercase">
            Hub de Gestão
          </p>
        </div>

        <section
          aria-labelledby="entrar"
          className="rounded-2xl bg-off p-6 shadow-xl sm:p-8"
        >
          <h1
            id="entrar"
            className="font-heading text-2xl font-semibold text-navy"
          >
            Entrar no Hub
          </h1>
          <p className="mt-1 text-sm text-ink-2">Acesso da equipe Harmony.</p>
          <Suspense fallback={<FormSkeleton />}>
            <LoginFormFromUrl searchParams={searchParams} />
          </Suspense>
        </section>

        <p className="text-center text-xs text-mist-2">
          A IA executa. O humano decide.
        </p>
      </main>
    </div>
  );
}

async function LoginFormFromUrl({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const next = safeNextPath(first(params.next));
  // Só no computador de quem programa; em produção o ramo some do build.
  let localLogin = false;
  if (process.env.NODE_ENV !== "production") {
    const { devLoginEnabled } = await import("@/lib/auth/dev-login");
    localLogin = devLoginEnabled();
  }
  return (
    <>
      <LoginForm
        next={next}
        initialError={loginErrorMessage(first(params.erro))}
        magicLink={magicLinkEnabled()}
        configured={authConfig() !== null}
      />
      {localLogin ? (
        <form
          action={entrarLocal}
          className="mt-4 rounded-lg border border-dashed border-brand/60 p-3"
        >
          <input type="hidden" name="next" value={next} />
          <p className="text-xs text-ink-2">
            Ambiente local de desenvolvimento, com o banco de teste.
          </p>
          <button
            type="submit"
            className="mt-2 text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
          >
            Entrar como dono, sem senha (só neste computador)
          </button>
        </form>
      ) : null}
    </>
  );
}

function FormSkeleton() {
  return (
    <div aria-hidden="true" className="mt-6 flex flex-col gap-4">
      <div className="h-[70px] rounded-lg bg-off-2" />
      <div className="h-[70px] rounded-lg bg-off-2" />
      <div className="h-11 rounded-lg bg-brand/40" />
    </div>
  );
}
