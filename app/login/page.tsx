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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-sm rounded-xl border border-slate-300 bg-white p-6">
        <p className="mb-2 text-sm text-slate-600">Prototype · Data dummy</p>

        <h1 className="text-2xl font-semibold">Masuk ke Upaznet</h1>

        <p className="mt-2 text-sm text-slate-600">
          Gunakan akun staf yang sudah dibuat.
        </p>

        <form action={login} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 min-h-10 w-full rounded-md border border-slate-500 px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>

            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 min-h-10 w-full rounded-md border border-slate-500 px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            className="min-h-10 w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Masuk
          </button>
        </form>
      </section>
    </main>
  );
}
