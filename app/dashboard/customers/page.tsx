import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CUSTOMER_PAGE_SIZE,
  listCustomers,
  listUnlinkedSenders,
} from "@/lib/repositories/customers";

export const metadata: Metadata = { title: "Pelanggan · Upaznet Helpdesk" };
export const dynamic = "force-dynamic";

type Params = { q?: string | string[]; status?: string | string[]; page?: string | string[] };
const buttonStyle = "inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] transition-colors";

function directoryUrl(search: string, status: string, page: number) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  return "/dashboard/customers" + (params.size ? "?" + params.toString() : "");
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const client = await createClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const status = params.status === "active" || params.status === "inactive" ? params.status : "all";
  const pageValue = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 && pageValue <= 100000 ? pageValue : 1;

  // Session staf tetap dipakai; tidak ada service-role client pada halaman ini.
  const results = await Promise.all([
    listCustomers(client, { search, status, page }),
    listUnlinkedSenders(client),
  ]).catch(() => null);

  const failed = !results || Boolean(results[0].error) || Boolean(results[1].error);
  if (failed) {
    console.error("[CustomersPage query failure]:", {
      resultsNull: !results,
      customerError: results?.[0]?.error,
      unlinkedError: results?.[1]?.error,
    });
  }
  const customers = results?.[0].data ?? [];
  const count = results?.[0].count ?? 0;
  const unknownSenders = results?.[1].data ?? [];
  const unknownCount = results?.[1].count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / CUSTOMER_PAGE_SIZE));
  const filtered = Boolean(search) || status !== "all";
  const currentUrl = directoryUrl(search, status, page);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-wider text-[var(--status-info-text)] uppercase">DIREKTORI LAYANAN</p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">Pelanggan</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Lihat identitas pelanggan, layanan, dan pemetaan wilayah dalam satu tempat.</p>
      </div>

      <div className="rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">Status jaringan: belum diperiksa.</strong>{" "}
        Status aktif di bawah adalah status administrasi pelanggan dan layanan, bukan hasil pemeriksaan koneksi.
      </div>

      <section aria-labelledby="customer-list-heading" className="overflow-hidden rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="border-b border-[var(--border-subtle)] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="customer-list-heading" className="text-lg font-semibold text-[var(--text-primary)]">Daftar pelanggan</h2>
            {!failed && <span className="text-sm text-[var(--text-secondary)]">{count} pelanggan{filtered ? " sesuai filter" : ""}</span>}
          </div>
          <form action="/dashboard/customers" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="customer-search" className="block text-sm font-medium text-[var(--text-primary)]">Cari nama atau kode pelanggan</label>
              <input id="customer-search" type="search" name="q" defaultValue={search} maxLength={80} placeholder="Contoh: Dummy 01 atau DUMMY-CUST-001" className="mt-1 min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] w-full rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-field)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]" />
            </div>
            <div>
              <label htmlFor="customer-status" className="block text-sm font-medium text-[var(--text-primary)]">Status pelanggan</label>
              <select id="customer-status" name="status" defaultValue={status} className="mt-1 min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] w-full rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
                <option value="all">Semua status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Tidak aktif</option>
              </select>
            </div>
            <button type="submit" className="min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] rounded-[var(--radius-control)] bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] transition-colors">Terapkan</button>
            {(filtered || page > 1) && <Link href="/dashboard/customers" className={buttonStyle}>Reset</Link>}
          </form>
        </div>

        {failed ? (
          <div role="alert" className="m-5 rounded-[var(--radius-container)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-5">
            <h3 className="font-semibold text-[var(--status-danger-text)]">Data pelanggan belum dapat dimuat</h3>
            <p className="mt-2 text-sm text-[var(--status-danger-text)]">Periksa koneksi ke database lalu coba kembali. Data tidak ditampilkan sebagai daftar kosong ketika terjadi kegagalan.</p>
            <form action={currentUrl} method="get" className="mt-4">
              <input type="hidden" name="q" value={search} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="page" value={page} />
              <button type="submit" className={buttonStyle}>Coba lagi</button>
            </form>
          </div>
        ) : customers.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <h3 className="font-semibold text-[var(--text-primary)]">{filtered ? "Tidak ada pelanggan yang cocok" : page > 1 ? "Tidak ada pelanggan di halaman ini" : "Belum ada data pelanggan"}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{filtered ? "Coba nama atau kode lain, atau hapus filter yang digunakan." : page > 1 ? "Kembali ke halaman pertama untuk melihat data yang tersedia." : "Data pelanggan akan tampil setelah fixture lokal disiapkan."}</p>
            {(filtered || page > 1) && <Link href="/dashboard/customers" className={"mt-4 " + buttonStyle}>Lihat semua pelanggan</Link>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto" role="region" aria-label="Tabel pelanggan, geser horizontal pada layar kecil" tabIndex={0}>
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">Pelanggan beserta layanan, pemetaan ODP/ODC aktif, dan identitas channel.</caption>
                <thead className="bg-[var(--bg-rail)] text-xs text-[var(--text-secondary)]">
                  <tr>
                    {["Pelanggan", "Layanan", "Pemetaan wilayah", "Identitas channel"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-semibold">{label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="align-top hover:bg-[var(--bg-field)] transition-colors">
                      <th scope="row" className="px-5 py-4 font-normal">
                        <p className="font-semibold text-[var(--text-primary)]">{customer.display_name}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{customer.customer_code}</p>
                        <span className={"mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium " + (customer.status === "active" ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]" : "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--status-neutral-border)]")}>{customer.status === "active" ? "Aktif" : "Tidak aktif"}</span>
                      </th>
                      <td className="px-5 py-4">
                        {customer.services.length === 0 ? <span className="text-[var(--text-muted)]">Belum ada layanan</span> : customer.services.map((service) => (
                          <div key={service.id} className="mb-3 last:mb-0">
                            <p className="font-mono text-xs text-[var(--text-primary)]">{service.service_code}</p>
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">{service.status === "active" ? "Layanan aktif" : "Layanan tidak aktif"}</p>
                          </div>
                        ))}
                      </td>
                      <td className="px-5 py-4">
                        {customer.services.length === 0 ? <span className="text-[var(--text-muted)]">Belum dipetakan</span> : customer.services.map((service) => (
                          <div key={service.id} className="mb-3 last:mb-0">
                            {customer.services.length > 1 && <p className="mb-1 text-xs text-[var(--text-secondary)]">{service.service_code}</p>}
                            {service.service_topology.length === 0 ? <span className="text-[var(--text-muted)]">Belum dipetakan</span> : service.service_topology.map((mapping) => (
                              <div key={mapping.id}>
                                <p className="font-medium text-[var(--text-primary)]">{mapping.odps?.odp_code ?? "ODP tidak tersedia"}</p>
                                <p className="mt-1 text-xs text-[var(--text-secondary)]">{mapping.odps?.odcs?.odc_code ?? "ODC tidak tersedia"} · Versi {mapping.mapping_version}</p>
                              </div>
                            ))}
                          </div>
                        ))}
                      </td>
                      <td className="px-5 py-4">
                        {customer.channel_identities.length === 0 ? <span className="text-[var(--text-muted)]">Belum ditautkan</span> : customer.channel_identities.map((identity) => (
                          <div key={identity.id} className="mb-3 last:mb-0">
                            <p className="capitalize text-[var(--text-primary)]">{identity.channel}</p>
                            <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{identity.sender_external_id}</p>
                            <span className={"mt-1 inline-block rounded-full px-2 py-1 text-xs " + (identity.verification_status === "verified" ? "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)]" : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]")}>{identity.verification_status === "verified" ? "Terverifikasi" : "Belum terverifikasi"}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-4 text-sm text-[var(--text-secondary)]">
              <span>Halaman {page} dari {pageCount} · Maksimal {CUSTOMER_PAGE_SIZE} pelanggan per halaman</span>
              <nav aria-label="Halaman daftar pelanggan" className="flex gap-2">
                {page > 1 && <Link href={directoryUrl(search, status, page - 1)} className={buttonStyle}>Sebelumnya</Link>}
                {page < pageCount && <Link href={directoryUrl(search, status, page + 1)} className={buttonStyle}>Berikutnya</Link>}
              </nav>
            </div>
          </>
        )}
      </section>

      {!failed && (
        <section aria-labelledby="unlinked-heading" className="rounded-[var(--radius-container)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="unlinked-heading" className="text-lg font-semibold text-[var(--text-primary)]">Pengirim belum ditautkan</h2>
            <span className="rounded-full bg-[var(--status-warning-bg)] px-2 py-1 text-xs font-medium text-[var(--status-warning-text)] border border-[var(--status-warning-border)]">{unknownCount} pengirim</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Identitas ini belum dikaitkan ke pelanggan. Mengetahui ID pelanggan saja bukan bukti kepemilikan. Daftar ini tidak mengikuti filter pelanggan di atas.</p>
          {unknownSenders.length === 0 ? <p className="mt-4 text-sm text-[var(--text-muted)]">Tidak ada pengirim yang menunggu penautan.</p> : (
            <ul className="mt-4 divide-y divide-[var(--border-subtle)]">
              {unknownSenders.map((sender) => (
                <li key={sender.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div><p className="text-sm font-medium text-[var(--text-primary)]">{sender.display_name_snapshot ?? "Pengirim tanpa nama"}</p><p className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">{sender.channel} · {sender.sender_external_id}</p></div>
                  <span className="rounded-full bg-[var(--status-warning-bg)] px-2 py-1 text-xs text-[var(--status-warning-text)] border border-[var(--status-warning-border)]">Belum terverifikasi</span>
                </li>
              ))}
            </ul>
          )}
          {unknownCount > 5 && <p className="mt-3 text-xs text-[var(--text-muted)]">Menampilkan 5 pengirim pertama dari {unknownCount}.</p>}
        </section>
      )}
    </div>
  );
}
