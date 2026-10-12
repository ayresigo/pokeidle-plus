import { Suspense } from "react";
import { AccountForm } from "@/components/AccountForm";

export const instant = false;

export default function EditarContaPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">carregando conta…</p>}>
      <AccountForm editar />
    </Suspense>
  );
}
