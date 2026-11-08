"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
