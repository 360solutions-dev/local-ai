import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import QueryProvider from "@/lib/query-provider";
import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "local-ai.run",
  description: "Local AI — chat, dashboard, and tools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrainsMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme')||'dark';var r=t==='system'?window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light':t;document.documentElement.classList.add(r);var a=localStorage.getItem('accentColor')||'emerald';var d={emerald:['#34d399','#22d3ee','#2d4a3e','#34d399'],cyan:['#22d3ee','#34d399','#1e3a4a','#22d3ee'],violet:['#a78bfa','#c084fc','#3b2d5e','#a78bfa'],amber:['#f59e0b','#fbbf24','#4a3b1e','#f59e0b'],rose:['#fb7185','#f472b6','#4a2d3e','#fb7185']};var l={emerald:['#22b07d','#1aa8c9','#a7d7c5','#22b07d'],cyan:['#1aa8c9','#22b07d','#a7c5d7','#1aa8c9'],violet:['#8b5cf6','#a855f7','#c5a7d7','#8b5cf6'],amber:['#d97b06','#ca8a04','#d7c5a7','#d97b06'],rose:['#e11d48','#db2777','#d7a7b5','#e11d48']};var p=(r==='light'?l:d)[a]||d.emerald;var s=document.documentElement.style;s.setProperty('--color-accent',p[0]);s.setProperty('--color-accent-secondary',p[1]);s.setProperty('--color-border-accent',p[2]);s.setProperty('--color-border-focus',p[3]);var lang=localStorage.getItem('language')||'en';document.documentElement.lang=lang}catch(e){}})()` }} />
      </head>
      <body style={{ margin: 0 }}>
        <QueryProvider><LanguageProvider>{children}</LanguageProvider></QueryProvider>
      </body>
    </html>
  );
}
