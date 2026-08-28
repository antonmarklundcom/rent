/**
 * Owner statement as HTML (#3): `/api/estados/<id>.html`.
 *
 * Access is server-side gated: admins see every statement, an owner sees only
 * their own (plan §2 — UI hiding is never the boundary).
 */
import { getStatementDetail } from "@/db/queries/statements";
import { AuthError, isAdmin } from "@/lib/auth-core";
import { requireUser } from "@/lib/auth";
import { renderStatementHtml } from "@/lib/statement-html";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const statementId = Number.parseInt(raw.replace(/\.html?$/i, ""), 10);
  if (!Number.isInteger(statementId) || statementId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthError) return new Response("Iniciá sesión", { status: 401 });
    throw error;
  }

  const detail = await getStatementDetail(statementId);
  if (!detail) return new Response("Not found", { status: 404 });
  if (!isAdmin(user) && detail.statement.ownerId !== user.ownerId) {
    return new Response("No tenés permiso", { status: 403 });
  }

  return new Response(renderStatementHtml(detail), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
