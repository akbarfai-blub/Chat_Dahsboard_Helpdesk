import type { createClient } from "@/lib/supabase/server";

type StaffClient = Awaited<ReturnType<typeof createClient>>;
export const CUSTOMER_PAGE_SIZE = 25;

export async function listCustomers(
  client: StaffClient,
  filters: { search: string; status: "all" | "active" | "inactive"; page: number },
) {
  let query = client
    .from("customers")
    .select(
      `id, customer_code, display_name, status,
       channel_identities(id, channel, sender_external_id, verification_status),
       services(id, service_code, status,
         service_topology(id, mapping_version, valid_to,
           odps(odp_code, odcs(odc_code))))`,
      { count: "exact" },
    )
    .is("services.service_topology.valid_to", null)
    .order("customer_code");

  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.search) {
    // Regex literal menghindari alias wildcard "*" dari operator LIKE PostgREST.
    // Escape regex terlebih dahulu, kemudian quoted value pada parser PostgREST.
    const literal = filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = '"' + literal.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    query = query.or("customer_code.imatch." + pattern + ",display_name.imatch." + pattern);
  }

  const offset = (filters.page - 1) * CUSTOMER_PAGE_SIZE;
  const result = await query.range(offset, offset + CUSTOMER_PAGE_SIZE - 1);
  // Offset di luar hasil adalah halaman kosong, bukan kegagalan database.
  if (result.error?.code === "PGRST103" && filters.page > 1) {
    return { ...result, data: [], error: null };
  }
  return result;
}

export async function listUnlinkedSenders(client: StaffClient) {
  return client
    .from("channel_identities")
    .select("id, channel, sender_external_id, display_name_snapshot", { count: "exact" })
    .eq("verification_status", "unverified")
    .is("customer_id", null)
    .order("created_at")
    .order("id")
    .limit(5);
}


