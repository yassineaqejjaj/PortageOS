import "@portage/design-system/portage.css";
import "./app.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { Providers } from "./providers";

// Polices OFL auto-hébergées via des paquets npm (aucun téléchargement au build ni appel à Google à l'exécution : RGPD et builds reproductibles).

export const metadata = { title: "PORTAGE OS" };

// Thème: préférence système, appliquée avant le premier rendu (évite le flash).
const themeScript = `try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className="po">
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
