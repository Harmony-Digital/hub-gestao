"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Botão que abre um formulário numa janela (dialog nativo: foco preso e Esc fecha).
 * Cada abertura começa um formulário limpo, sem o erro da vez anterior, e o formulário
 * só é montado na primeira abertura (listas longas não carregam um por linha). Clicar
 * fora não fecha, para um formulário longo não se perder por engano.
 */
export function FormDialog({
  label,
  accessibleLabel,
  icon,
  variant = "outline",
  size = "lg",
  title,
  description,
  wide = false,
  children,
}: {
  /** Texto do botão. */
  label: string;
  /** Nome completo para leitor de tela quando o texto é curto (ex.: "Editar M2"). */
  accessibleLabel?: string;
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  title: string;
  description?: ReactNode;
  wide?: boolean;
  /** O formulário; recebe a função que fecha a janela. */
  children: (close: () => void) => ReactNode;
}) {
  // A janela fica em estado, não em ref: a função de fechar é entregue ao formulário
  // durante a renderização, onde ref não pode ser usada.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [round, setRound] = useState(0);
  const titleId = useId();
  const close = () => dialog?.close();

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        aria-label={accessibleLabel}
        onClick={() => {
          setRound((r) => r + 1);
          dialog?.showModal();
        }}
      >
        {icon}
        {label}
      </Button>
      <dialog
        ref={setDialog}
        aria-labelledby={titleId}
        className={`m-auto ${wide ? "w-[min(94vw,42rem)]" : "w-[min(92vw,30rem)]"} max-w-none rounded-2xl border border-line bg-paper p-0 text-left whitespace-normal text-ink shadow-2xl backdrop:bg-navy-3/50`}
      >
        <div key={round} className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2
              id={titleId}
              className="font-heading text-lg font-semibold text-navy"
            >
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-ink-2">{description}</p>
            ) : null}
          </div>
          {round > 0 ? children(close) : null}
        </div>
      </dialog>
    </>
  );
}
