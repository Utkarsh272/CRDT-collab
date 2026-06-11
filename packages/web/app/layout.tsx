import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collab — Real-time Collaborative Docs",
  description: "Conflict-free real-time collaboration powered by CRDTs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans bg-surface text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
