export default function LoadingCustomers() {
  return (
    <main aria-busy="true" aria-label="Memuat pelanggan" className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <p role="status" className="text-sm text-slate-600">Memuat data pelanggan…</p>
      <div aria-hidden="true" className="mt-6 space-y-4">
        <div className="h-8 w-52 rounded bg-slate-200" />
        <div className="h-20 rounded-lg bg-white" />
        {[1, 2, 3, 4].map((row) => <div key={row} className="h-20 rounded-lg border border-slate-200 bg-white" />)}
      </div>
    </main>
  );
}
