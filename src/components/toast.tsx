"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Hoisted feedback for `ActionForm` (plan §6.S3 fix #5: "a success message
 * disappears when its form unmounts").
 *
 * On `/admin/reservas/[id]` and elsewhere, a server action's result swaps the
 * row that produced it (verify → "revisado", delete → the row is gone), which
 * unmounts the `ActionForm` before anyone reads its confirmation. Toasts live
 * in `ToastProvider`, one level up in each route's own layout — a subtree
 * unmounting below it never touches this state, so the message survives the
 * swap. `ActionForm` pushes into it via `useToast()`; it also still renders
 * its own inline text for the (common) case where the form does NOT unmount,
 * so nothing regresses there.
 */
type Toast = { id: number; tone: "ok" | "error"; text: string };

type ToastContextValue = { push: (tone: Toast["tone"], text: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // No provider above (a stray page) — swallow rather than crash; ActionForm's
  // own inline rendering still shows the message.
  return ctx ?? { push: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-raised ${
              toast.tone === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-ink/10 bg-ink text-base"
            }`}
          >
            <span className="grow">{toast.text}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Cerrar"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
