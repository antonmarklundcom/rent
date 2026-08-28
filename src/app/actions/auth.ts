"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, login, logout } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().trim().min(3).max(255),
  password: z.string().min(1).max(200),
});

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "required" };

  let target = "/";
  try {
    const user = await login(parsed.data.email, parsed.data.password);
    target = user.role === "owner" ? "/panel" : "/admin";
  } catch (error) {
    if (error instanceof AuthError) return { error: "invalid" };
    throw error;
  }
  redirect(target);
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/");
}
