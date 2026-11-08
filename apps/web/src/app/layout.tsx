import "./tokens.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata = { title: "PORTAGE OS" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="fr"><body><Providers>{children}</Providers></body></html>);
}
