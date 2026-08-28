import { logoutAction } from "@/app/actions/auth";

export function LogoutButton({ label }: { label: string }) {
  return (
    <form action={logoutAction}>
      <button type="submit" className="underline">
        {label}
      </button>
    </form>
  );
}
