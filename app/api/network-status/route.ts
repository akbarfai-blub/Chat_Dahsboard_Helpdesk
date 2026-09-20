import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inspectMockNetwork } from "@/lib/application/inspect-network";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, data: null, error: { code, message } }, { status, headers });
}

export async function GET(request: Request) {
  // Explicit prototype switch; never auto-enable mock diagnostics on a production deployment.
  if (process.env.NETWORK_PROVIDER !== "mock") return failure(503, "PROVIDER_DISABLED", "Pemeriksaan mock belum diaktifkan.");
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf.");
    const params = new URL(request.url).searchParams;
    const customerId = params.get("customerId") ?? "";
    const serviceId = params.get("serviceId") ?? "";
    const scenario = params.get("scenario") ?? "normal";
    if (!uuid.test(customerId) || !uuid.test(serviceId) || !/^[a-z][a-z0-9_]{0,63}$/.test(scenario) ||
        ["customerId", "serviceId", "scenario"].some(key => params.getAll(key).length > 1)) {
      return failure(400, "INVALID_INPUT", "ID pelanggan, layanan, atau skenario tidak valid.");
    }
    const result = await inspectMockNetwork(client, customerId, serviceId, scenario);
    // A completed inspection can contain stale/unknown/partial evidence; read per-component quality.
    if (result.outcome === "ok") return NextResponse.json({ success: true, data: result, error: null }, { headers });
    const status = result.outcome === "not_found" ? 404 : result.reason === "timeout" ? 504 : 502;
    return NextResponse.json({
      success: false, data: result,
      error: { code: result.reason?.toUpperCase(), message: "Pemeriksaan belum menghasilkan bukti lengkap. Periksa status tiap sumber." },
    }, { status, headers });
  } catch {
    return failure(503, "INSPECTION_UNAVAILABLE", "Pemeriksaan jaringan belum tersedia. Coba kembali.");
  }
}

