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
        {/* Menu lateral recolhido (escolha guardada no navegador), aplicado antes de
            desenhar, para a barra não abrir e fechar na frente de quem usa. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("hub:menu")==="recolhido")document.documentElement.dataset.menu="recolhido"}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
