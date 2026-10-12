import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multiacc PokeIdle",
  description: "Painel local de contas PokeIdle",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
