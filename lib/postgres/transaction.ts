import type { Pool, PoolClient } from "pg";

// One mutation lock keeps prototype identity reconciliation and claim ordering consistent.
export async function inHelpdeskTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("begin isolation level read committed");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '10s'");
    await client.query("select pg_advisory_xact_lock(20260922, 14)");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { broken = true; }
    throw error;
  } finally {
    client.release(broken);
  }
}
