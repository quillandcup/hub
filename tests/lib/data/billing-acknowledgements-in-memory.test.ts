import { InMemoryBillingAcknowledgementRepository } from "@/lib/data/billing-acknowledgements";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineBillingAcknowledgementContract } from "@/tests/helpers/billing-acknowledgement-contract";

const MEMBERS: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];
let run = 0;

defineBillingAcknowledgementContract("InMemoryBillingAcknowledgementRepository", () => {
  const data = new InMemoryDataset({ members: MEMBERS.map((id, i) => ({ id, name: `Member ${i + 1} Example` })) });
  return { repo: () => new InMemoryBillingAcknowledgementRepository(data), members: MEMBERS, staff: "user-1", keyPrefix: `run${++run}` };
});
