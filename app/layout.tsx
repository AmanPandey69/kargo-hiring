import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kargo Hiring",
  description: "Rank and explain PM / SPM candidates against the Kargo rubric",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
            <Link href="/dashboard" className="mr-4 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-700 text-sm font-bold text-white">K</span>
              <span className="font-semibold tracking-tight">Kargo Hiring</span>
            </Link>
            <NavLink href="/">Upload</NavLink>
            <NavLink href="/dashboard">Dashboard</NavLink>
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-stone-500 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              The system recommends. Arjun decides.
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
