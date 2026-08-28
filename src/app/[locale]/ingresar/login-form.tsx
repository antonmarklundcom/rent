"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";

type Labels = {
  email: string;
  password: string;
  submit: string;
  invalid: string;
  required: string;
};

export function LoginForm({ labels }: { labels: Labels }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm">{labels.email}</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">{labels.password}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error === "required" ? labels.required : labels.invalid}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
