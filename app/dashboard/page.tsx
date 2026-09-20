import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <section className="mx-auto max-w-3xl rounded-xl border border-slate-300 bg-white p-6">
        <p className="text-sm text-slate-600">Prototype · Data dummy</p>

        <h1 className="mt-2 text-2xl font-semibold">Dashboard Helpdesk</h1>

        <p className="mt-4">
          Kamu masuk sebagai <strong>{data.user.email}</strong>.
        </p>

        <p className="mt-2 text-sm text-slate-600">
          Direktori pelanggan sudah tersedia. Antrean komplain dibuat pada tahap berikutnya.
        </p>

        {params.error === "logout" && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            Logout belum berhasil. Periksa koneksi lalu coba kembali.
          </p>
        )}

        <Link href="/dashboard/customers" className="mt-6 inline-flex min-h-10 items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Lihat pelanggan</Link>
        <form action={logout} className="mt-6">
          <button
            type="submit"
            className="min-h-10 rounded-md border border-slate-500 px-4 py-2 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Keluar
          </button>
        </form>
      </section>
    </main>
  );
}

