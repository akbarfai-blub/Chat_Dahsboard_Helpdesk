import { isValidSenderKey, manualIdentity, resolveSenderIdentity } from "../domain/sender-identity";
import type { IdentityResolution, SenderKey } from "../domain/sender-identity";
import type { IdentityLookup, IdentitySnapshotStore } from "./identity-lookup";

export const IDENTITY_LOOKUP_TIMEOUT_MS = 2000;

export class StoredIdentityLookup implements IdentityLookup {
  constructor(
    private readonly store: IdentitySnapshotStore,
    private readonly timeoutMs = IDENTITY_LOOKUP_TIMEOUT_MS,
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new Error("Invalid identity lookup timeout");
    }
  }

  async resolve(sender: SenderKey): Promise<IdentityResolution> {
    if (!isValidSenderKey(sender)) return manualIdentity("invalid_sender");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const checkedAt = new Date(this.clock()).toISOString();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, this.timeoutMs);
      });
      const rows = await Promise.race([this.store.find(sender, controller.signal), timeout]);
      return resolveSenderIdentity(sender, rows, checkedAt);
    } catch {
      return manualIdentity(controller.signal.aborted ? "timeout" : "lookup_error");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
