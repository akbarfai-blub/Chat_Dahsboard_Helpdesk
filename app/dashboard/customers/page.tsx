import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import {
  CUSTOMER_PAGE_SIZE,
  listCustomers,
  listUnlinkedSenders,
} from "@/lib/repositories/customers";

export const metadata: Metadata = { title: "Pelanggan · Upaznet Helpdesk" };
export const dynamic = "force-dynamic";

type Params = { q?: string | string[]; status?: string | string[]; page?: string | string[] };
const buttonStyle = "inline-flex min-h-10 items-center justify-center rounded-md border border-slate-500 px-4 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

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
  const customers = results?.[0].data ?? [];
  const count = results?.[0].count ?? 0;
  const unknownSenders = results?.[1].data ?? [];
  const unknownCount = results?.[1].count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / CUSTOMER_PAGE_SIZE));
  const filtered = Boolean(search) || status !== "all";
  const currentUrl = directoryUrl(search, status, page);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col lg:flex-row">
        <aside className="border-b border-slate-300 bg-white px-5 py-5 lg:w-[216px] lg:shrink-0 lg:border-r lg:border-b-0">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-blue-600">
            Upaznet<span className="text-blue-700">.</span>
          </Link>
          <p className="mt-1 text-xs text-slate-600">HELPDESK WORKSPACE</p>
          <nav aria-label="Navigasi dashboard" className="mt-6 flex gap-2 lg:flex-col">
            <Link href="/dashboard" className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">Ringkasan</Link>
            <Link href="/dashboard/customers" aria-current="page" className="rounded-md border-l-2 border-blue-700 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 focus-visible:outline-2 focus-visible:outline-blue-600">Pelanggan</Link>
          </nav>
          <p className="mt-8 hidden text-xs leading-5 text-slate-600 lg:block">Ruang kerja prototype.<br />Seluruh identitas seed adalah data simulasi.</p>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-white px-6 py-4">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">Prototype · Data dummy</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="max-w-64 truncate text-sm text-slate-600" title={auth.user.email}>{auth.user.email}</span>
              <form action={logout}><button className={buttonStyle} type="submit">Keluar</button></form>
            </div>
          </header>

          <main className="space-y-6 p-4 sm:p-6 lg:p-8">
            <div>
              <p className="text-xs font-semibold tracking-wider text-blue-800">DIREKTORI LAYANAN</p>
              <h1 className="mt-2 text-2xl font-semibold">Pelanggan</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Lihat identitas pelanggan, layanan, dan pemetaan wilayah dalam satu tempat.</p>
            </div>

            <div className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
              <strong className="text-slate-900">Status jaringan: belum diperiksa.</strong>{" "}
              Status aktif di bawah adalah status administrasi pelanggan dan layanan, bukan hasil pemeriksaan koneksi.
            </div>

            <section aria-labelledby="customer-list-heading" className="overflow-hidden rounded-xl border border-slate-300 bg-white">
              <div className="border-b border-slate-300 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 id="customer-list-heading" className="text-lg font-semibold">Daftar pelanggan</h2>
                  {!failed && <span className="text-sm text-slate-600">{count} pelanggan{filtered ? " sesuai filter" : ""}</span>}
                </div>
                <form action="/dashboard/customers" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label htmlFor="customer-search" className="block text-sm font-medium">Cari nama atau kode pelanggan</label>
                    <input id="customer-search" type="search" name="q" defaultValue={search} maxLength={80} placeholder="Contoh: Dummy 01 atau DUMMY-CUST-001" className="mt-1 min-h-10 w-full rounded-md border border-slate-500 px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                  </div>
                  <div>
                    <label htmlFor="customer-status" className="block text-sm font-medium">Status pelanggan</label>
                    <select id="customer-status" name="status" defaultValue={status} className="mt-1 min-h-10 w-full rounded-md border border-slate-500 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                      <option value="all">Semua status</option>
                      <option value="active">Aktif</option>
                      <option value="inactive">Tidak aktif</option>
                    </select>
                  </div>
                  <button type="submit" className="min-h-10 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Terapkan</button>
                  {(filtered || page > 1) && <Link href="/dashboard/customers" className={buttonStyle}>Reset</Link>}
                </form>
              </div>

              {failed ? (
                <div role="alert" className="m-5 rounded-lg border border-red-200 bg-red-50 p-5">
                  <h3 className="font-semibold text-red-700">Data pelanggan belum dapat dimuat</h3>
                  <p className="mt-2 text-sm text-red-700">Periksa koneksi ke database lalu coba kembali. Data tidak ditampilkan sebagai daftar kosong ketika terjadi kegagalan.</p>
                  <form action={currentUrl} method="get" className="mt-4">
                    <input type="hidden" name="q" value={search} />
                    <input type="hidden" name="status" value={status} />
                    <input type="hidden" name="page" value={page} />
                    <button type="submit" className={buttonStyle}>Coba lagi</button>
                  </form>
                </div>
              ) : customers.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <h3 className="font-semibold">{filtered ? "Tidak ada pelanggan yang cocok" : page > 1 ? "Tidak ada pelanggan di halaman ini" : "Belum ada data pelanggan"}</h3>
                  <p className="mt-2 text-sm text-slate-600">{filtered ? "Coba nama atau kode lain, atau hapus filter yang digunakan." : page > 1 ? "Kembali ke halaman pertama untuk melihat data yang tersedia." : "Data pelanggan akan tampil setelah fixture lokal disiapkan."}</p>
                  {(filtered || page > 1) && <Link href="/dashboard/customers" className={"mt-4 " + buttonStyle}>Lihat semua pelanggan</Link>}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto" role="region" aria-label="Tabel pelanggan, geser horizontal pada layar kecil" tabIndex={0}>
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <caption className="sr-only">Pelanggan beserta layanan, pemetaan ODP/ODC aktif, dan identitas channel.</caption>
                      <thead className="bg-slate-100 text-xs text-slate-600">
                        <tr>
                          {["Pelanggan", "Layanan", "Pemetaan wilayah", "Identitas channel"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-semibold">{label}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {customers.map((customer) => (
                          <tr key={customer.id} className="align-top hover:bg-slate-50">
                            <th scope="row" className="px-5 py-4 font-normal">
                              <p className="font-semibold">{customer.display_name}</p>
                              <p className="mt-1 font-mono text-xs text-slate-600">{customer.customer_code}</p>
                              <span className={"mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium " + (customer.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600")}>{customer.status === "active" ? "Aktif" : "Tidak aktif"}</span>
                            </th>
                            <td className="px-5 py-4">
                              {customer.services.length === 0 ? <span className="text-slate-600">Belum ada layanan</span> : customer.services.map((service) => (
                                <div key={service.id} className="mb-3 last:mb-0">
                                  <p className="font-mono text-xs">{service.service_code}</p>
                                  <p className="mt-1 text-xs text-slate-600">{service.status === "active" ? "Layanan aktif" : "Layanan tidak aktif"}</p>
                                </div>
                              ))}
                            </td>
                            <td className="px-5 py-4">
                              {customer.services.length === 0 ? <span className="text-slate-600">Belum dipetakan</span> : customer.services.map((service) => (
                                <div key={service.id} className="mb-3 last:mb-0">
                                  {customer.services.length > 1 && <p className="mb-1 text-xs text-slate-600">{service.service_code}</p>}
                                  {service.service_topology.length === 0 ? <span className="text-slate-600">Belum dipetakan</span> : service.service_topology.map((mapping) => (
                                    <div key={mapping.id}>
                                      <p className="font-medium">{mapping.odps?.odp_code ?? "ODP tidak tersedia"}</p>
                                      <p className="mt-1 text-xs text-slate-600">{mapping.odps?.odcs?.odc_code ?? "ODC tidak tersedia"} · Versi {mapping.mapping_version}</p>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </td>
                            <td className="px-5 py-4">
                              {customer.channel_identities.length === 0 ? <span className="text-slate-600">Belum ditautkan</span> : customer.channel_identities.map((identity) => (
                                <div key={identity.id} className="mb-3 last:mb-0">
                                  <p className="capitalize">{identity.channel}</p>
                                  <p className="mt-1 font-mono text-xs text-slate-600">{identity.sender_external_id}</p>
                                  <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-800">{identity.verification_status === "verified" ? "Terverifikasi" : "Belum terverifikasi"}</span>
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 px-5 py-4 text-sm text-slate-600">
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
              <section aria-labelledby="unlinked-heading" className="rounded-xl border border-slate-300 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="unlinked-heading" className="text-lg font-semibold">Pengirim belum ditautkan</h2>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{unknownCount} pengirim</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">Identitas ini belum dikaitkan ke pelanggan. Mengetahui ID pelanggan saja bukan bukti kepemilikan. Daftar ini tidak mengikuti filter pelanggan di atas.</p>
                {unknownSenders.length === 0 ? <p className="mt-4 text-sm text-slate-600">Tidak ada pengirim yang menunggu penautan.</p> : (
                  <ul className="mt-4 divide-y divide-slate-200">
                    {unknownSenders.map((sender) => (
                      <li key={sender.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div><p className="text-sm font-medium">{sender.display_name_snapshot ?? "Pengirim tanpa nama"}</p><p className="mt-1 break-all font-mono text-xs text-slate-600">{sender.channel} · {sender.sender_external_id}</p></div>
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">Belum terverifikasi</span>
                      </li>
                    ))}
                  </ul>
                )}
                {unknownCount > 5 && <p className="mt-3 text-xs text-slate-600">Menampilkan 5 pengirim pertama dari {unknownCount}.</p>}
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
