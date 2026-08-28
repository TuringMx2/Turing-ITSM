import type { Metadata, Viewport } from "next";
import { TimeThemeController } from "@/components/time-theme-controller";
import "./globals.css";

export const metadata: Metadata = {
  title: "TuringMx",
  description: "Plataforma empresarial de gestión de servicios y operaciones.",
};

export const viewport: Viewport = {
  themeColor: "#eef0ff",
};

const themeBootstrap = `(() => {
  const hour = new Date().getHours();
  const phase = hour < 5 ? "predawn" : hour < 9 ? "dawn" : hour < 18 ? "day" : hour < 21 ? "dusk" : "night";
  const colors = { predawn: "#171b3f", dawn: "#34345f", day: "#fff2bd", dusk: "#e9ddff", night: "#17182f" };
  document.documentElement.dataset.dayPhase = phase;
  const updateChrome = () => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[phase]);
  };
  updateChrome();
  document.addEventListener("DOMContentLoaded", updateChrome, { once: true });
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <TimeThemeController />
        {children}
      </body>
    </html>
  );
}
