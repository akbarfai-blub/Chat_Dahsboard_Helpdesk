import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InboxDashboard } from "@/components/inbox/inbox-dashboard";

export const metadata: Metadata = {
  title: "Inbox / Antrean · Upaznet Helpdesk",
  description: "Antrean percakapan masuk Telegram dan evaluasi auto-triage Upaznet Helpdesk.",
};

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  const params = await searchParams;

  return (
    <div className="flex flex-col flex-1 h-full min-h-0">
      {/* Alert Error Logout */}
      {params.error === "logout" && (
        <div
          role="alert"
          className="m-4 rounded-[var(--radius-container)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 text-xs text-[var(--status-danger-text)] shrink-0"
        >
          <strong className="font-semibold">Gagal keluar:</strong> Logout belum berhasil. Periksa koneksi lalu coba kembali.
        </div>
      )}

      {/* Top Utility Strip: Status Otomasi & Tautan Direktori Pelanggan */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[var(--text-primary)]">Workspace Antrean</span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="text-[var(--text-secondary)]">
            Mode Otomasi: <strong className="font-semibold text-[var(--text-primary)]">SHADOW</strong> (evaluasi internal tanpa pengiriman otomatis)
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">
            Data Dummy
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/dashboard/customers"
            className="inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
          >
            Buka Direktori Pelanggan
          </Link>
        </div>
      </div>

      {/* Main Inbox Dashboard Component */}
      <div className="flex-1 min-h-0 flex flex-col">
        <InboxDashboard />
      </div>
    </div>
  );
}
