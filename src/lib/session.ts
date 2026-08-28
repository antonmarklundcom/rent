import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import type { SessionUser } from "@/lib/auth-core";

export type { SessionUser };

export type SessionData = {
  user?: SessionUser;
};

const DEV_SECRET = "alquilar-development-only-secret-change-me-32+";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    // Never fall back to a known secret in production — refuse to sign instead.
    throw new Error(
      "SESSION_SECRET must be set to a 32+ character random string in production.",
    );
  }
  return DEV_SECRET;
}

export function sessionOptions(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: "alquilar_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session.user ?? null;
}
