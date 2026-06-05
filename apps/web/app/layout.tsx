import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Turing ITSM",
  description: "Customer portal and internal ITSM console.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
