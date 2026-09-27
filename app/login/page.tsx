import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();

  if (!authError && data.user) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  const errorMessage =
    params.error === "required"
      ? "Email dan password wajib diisi."
      : params.error === "login"
        ? "Login belum berhasil. Periksa email, password, dan koneksi."
        : params.error === "logout"
          ? "Logout belum berhasil. Periksa koneksi lalu coba kembali."
          : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-canvas)] p-6 text-[var(--text-primary)]">
      <section className="w-full max-w-sm rounded-[var(--radius-container)] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-sm">
        <div className="mb-3">
          <span className="inline-flex items-center rounded-[var(--radius-full)] border border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] px-2.5 py-0.5 type-micro text-[var(--status-neutral-text)]">
            Prototype · Data dummy
          </span>
        </div>

        <h1 className="type-display text-[var(--text-primary)]">
          Masuk ke Upaznet
        </h1>

        <p className="mt-2 type-body text-[var(--text-secondary)]">
          Gunakan akun staf yang sudah dibuat.
        </p>

        <form action={login} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block type-label text-[var(--text-primary)]"
            >
              Email
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] w-full rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-field)] px-3 type-body text-[var(--text-primary)] focus-ring"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block type-label text-[var(--text-primary)]"
            >
              Password
            </label>

            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] w-full rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-field)] px-3 type-body text-[var(--text-primary)] focus-ring"
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 type-body text-[var(--status-danger-text)]"
            >
              {errorMessage}
            </p>
          )}

          <button
            id="login-submit-button"
            type="submit"
            className="inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--action-primary)] px-4 py-2 type-action text-[var(--action-on-primary)] transition-colors duration-[var(--motion-duration-fast)] hover:bg-[var(--action-primary-hover)] focus-ring"
          >
            Masuk
          </button>
        </form>
      </section>
    </main>
  );
}

