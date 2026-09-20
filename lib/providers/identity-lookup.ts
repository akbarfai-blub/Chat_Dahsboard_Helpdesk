import type { IdentityCandidate, IdentityResolution, SenderKey } from "../domain/sender-identity";

export interface IdentitySnapshotStore {
  find(sender: SenderKey, signal: AbortSignal): Promise<IdentityCandidate[]>;
}
export interface IdentityLookup {
  resolve(sender: SenderKey): Promise<IdentityResolution>;
}
