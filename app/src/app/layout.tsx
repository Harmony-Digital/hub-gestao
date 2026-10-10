import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hub de Gestão · Harmony Digital",
    template: "%s · Hub de Gestão",
  },
  description:
    "Gestão de projetos, departamentos e atividades da Harmony Digital, operada por agentes e decidida por pessoas.",
  applicationName: "Hub de Gestão",
  // Uso interno: nada é indexado (o portal do cliente também nasce com noindex).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${sora.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // O script abaixo pode marcar o menu recolhido antes de o React assumir a página.
      suppressHydrationWarning
    >
      <head>
        {/* Menu lateral recolhido e tema (escolhas guardadas no navegador), aplicados
            antes de desenhar, para nada piscar na frente de quem usa. A regra do tema é
            a mesma de isDark (components/shell/theme.ts). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement;if(localStorage.getItem("hub:menu")==="recolhido")d.dataset.menu="recolhido";var t=localStorage.getItem("hub:tema");if(t==="escuro"||(t==="sistema"&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
