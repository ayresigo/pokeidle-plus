"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, type UpdateStatus } from "@/lib/api";

const INTERVALO_MS = 60_000;

export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let ativo = true;
    const carregar = () =>
      apiFetch<UpdateStatus>("/update/status").then(
        (atual) => {
          if (ativo) setStatus(atual);
        },
        () => {},
      );
    void carregar();
    const timer = setInterval(carregar, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  if (!status?.updateAvailable || status.latestVersion === null) return null;
  return (
    <Link
      href="/settings"
      className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
    >
      v{status.latestVersion} disponível
    </Link>
  );
}
