import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { IdentityCandidate, SenderKey } from "../domain/sender-identity";
import type { IdentitySnapshotStore } from "../providers/identity-lookup";

export class SupabaseIdentitySnapshotStore implements IdentitySnapshotStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async find(sender: SenderKey, signal: AbortSignal): Promise<IdentityCandidate[]> {
    // One relational SELECT keeps identity/customer/services in a single database snapshot.
    // Do not filter inactive services: multiple services must go to manual review.
    const { data, error } = await this.client.from("channel_identities").select(
      "id,channel,channel_account_id,sender_external_id,customer_id,verification_status,verified_at,customers(id,status,services(id,customer_id,status))",
    ).eq("channel", sender.channel).eq("channel_account_id", sender.channelAccountId)
      .eq("sender_external_id", sender.senderExternalId)
      .limit(2).limit(2, { referencedTable: "customers.services" }).abortSignal(signal);
    if (error) throw new Error("Identity snapshot unavailable");
    return data.map(row => ({
      id: row.id, channel: row.channel, channelAccountId: row.channel_account_id,
      senderExternalId: row.sender_external_id, customerId: row.customer_id,
      verificationStatus: row.verification_status, verifiedAt: row.verified_at,
      customer: row.customers ? {
        id: row.customers.id, status: row.customers.status,
        services: row.customers.services.map(service => ({
          id: service.id, customerId: service.customer_id, status: service.status,
        })),
      } : null,
    }));
  }
}
