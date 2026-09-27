import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
    <div className="space-y-6">
      {/* Alert Error Logout */}
      {params.error === "logout" && (
        <div
          role="alert"
          className="rounded-[var(--radius-container)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-text)]"
        >
          <strong className="font-semibold">Gagal keluar:</strong> Logout belum berhasil. Periksa koneksi lalu coba kembali.
        </div>
      )}

      {/* Header Halaman */}
      <div>
        <p className="text-xs font-semibold tracking-wider text-[var(--status-info-text)] uppercase">
          WORKSPACE OPERASIONAL
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
          Ringkasan Workspace
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
          Ruang kerja helpdesk Upaznet untuk triase percakapan komplain pelanggan dan pemeriksaan konteks jaringan.
        </p>
      </div>

      {/* Grid Informasi Status Workspace */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Card 1: Status Pengembangan Antrean Komplain */}
        <section
          aria-labelledby="inbox-status-heading"
          className="rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 shadow-xs flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-sm bg-[var(--status-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-warning-text)] border border-[var(--status-warning-border)]">
                Tahap Berikutnya
              </span>
              <span className="text-xs text-[var(--text-muted)]">P2 / P3</span>
            </div>
            <h2 id="inbox-status-heading" className="mt-3 text-lg font-bold text-[var(--text-primary)]">
              Inbox / Antrean Komplain
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Antrean percakapan masuk Telegram, evaluasi aturan triase (auto-triage), peninjauan bukti observasi jaringan, dan pengiriman balasan staf langsung dari dashboard saat ini sedang dalam persiapan implementasi tahap berikutnya.
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
              Sesuai batasan operasional, tidak ada data statistik antrean atau status realtime yang difabrikasi sebelum fungsionalitas triase aktif secara nyata.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              Status antrean: Belum tersedia dalam build ini
            </span>
          </div>
        </section>

        {/* Card 2: Fitur Tersedia - Direktori Pelanggan */}
        <section
          aria-labelledby="customers-feature-heading"
          className="rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 shadow-xs flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-sm bg-[var(--status-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-success-text)] border border-[var(--status-success-border)]">
                Tersedia
              </span>
              <span className="text-xs text-[var(--text-muted)]">Fitur Pendukung</span>
            </div>
            <h2 id="customers-feature-heading" className="mt-3 text-lg font-bold text-[var(--text-primary)]">
              Direktori Pelanggan & Layanan
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Fitur pendukung direktori pelanggan telah tersedia untuk pencarian identitas pelanggan, peninjauan status administrasi layanan, serta pemetaan topologi ODP dan ODC.
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
              Status pelanggan pada direktori adalah status administratif, bukan hasil pemeriksaan kondisi sinyal fisik perangkat.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
            <Link
              href="/dashboard/customers"
              className="inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] bg-[var(--action-primary)] px-4 py-2 text-sm font-semibold text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
            >
              Buka Direktori Pelanggan
            </Link>
          </div>
        </section>
      </div>

      {/* Card 3: Batasan Operasional Prototype */}
      <section
        aria-labelledby="prototype-boundaries-heading"
        className="rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 shadow-xs"
      >
        <h2 id="prototype-boundaries-heading" className="text-base font-bold text-[var(--text-primary)]">
          Integritas & Batasan Prototype
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm text-[var(--text-secondary)]">
          <div className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-4 border border-[var(--border-subtle)]">
            <h3 className="font-semibold text-[var(--text-primary)] text-xs uppercase tracking-wide">
              Mock Network Provider
            </h3>
            <p className="mt-1.5 text-xs leading-5">
              Observasi status ONU dan ODP/ODC dijalankan melalui penyedia tiruan (<code className="font-mono text-[var(--text-primary)]">NETWORK_PROVIDER=mock</code>) tanpa sambungan langsung ke perangkat OLT nyata.
            </p>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-4 border border-[var(--border-subtle)]">
            <h3 className="font-semibold text-[var(--text-primary)] text-xs uppercase tracking-wide">
              Data Seed Simulasi
            </h3>
            <p className="mt-1.5 text-xs leading-5">
              Seluruh identitas pelanggan, nomor layanan, dan kontak Telegram adalah fixture data simulasi untuk keperluan pengujian lokal.
            </p>
          </div>
          <div className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-4 border border-[var(--border-subtle)]">
            <h3 className="font-semibold text-[var(--text-primary)] text-xs uppercase tracking-wide">
              Pemisahan Sistem Custpanel
            </h3>
            <p className="mt-1.5 text-xs leading-5">
              Delegasi penugasan teknisi lapangan, pelaporan tiket resmi, dan transaksi keuangan tetap dikelola secara manual melalui Custpanel.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
