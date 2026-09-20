import { classifyMessage } from "../domain/message-classification";
import type { SenderKey } from "../domain/sender-identity";
import type { IdentityLookup } from "../providers/identity-lookup";

// Internal application boundary. A future authenticated ingress supplies sender metadata.
// No lookup of customer IDs typed into message text, no network inspection or sending.
export async function analyzeInboundMessage(
  input: { sender: SenderKey; text: unknown }, identities: IdentityLookup,
) {
  const classification = classifyMessage(input.text);
  const identity = await identities.resolve(input.sender);
  return { classification, identity };
}
