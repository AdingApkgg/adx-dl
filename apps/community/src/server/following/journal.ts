import { eq } from "drizzle-orm";
import { privateSocialFact, type PrivateSocialFact } from "@/shared/private-social-journal";
import { communityPrivateStates, storageTombstones } from "../db/schema";
import type { DbTransaction } from "../storage/contracts";
import { communityHash } from "../community/content-journal";
export { awaitChartJournal as awaitPrivateJournal } from "../charts/publication-journal";
/** Caller owns the relation/account/group lock. Facts contain IDs and controls, never names or text. */
export async function recordPrivateFact(tx:DbTransaction,input:PrivateSocialFact):Promise<number> {
 const fact=privateSocialFact.parse(input),key=`${fact.entity}:${fact.id}`;
 const [prior]=await tx.select().from(communityPrivateStates).where(eq(communityPrivateStates.key,key));
 if(prior){if(prior.revision===fact.revision&&communityHash(prior.fact)===communityHash(fact))return prior.journalSequence;
  if(prior.revision>=fact.revision)throw new Error("PRIVATE_SOCIAL_FACT_CONFLICT");}
 const [record]=await tx.insert(storageTombstones).values({kind:"private_social",payload:fact}).returning({sequence:storageTombstones.sequence});
 if(!record)throw new Error("PRIVATE_SOCIAL_FACT_MISSING");
 await tx.insert(communityPrivateStates).values({key,entity:fact.entity,revision:fact.revision,fact,journalSequence:record.sequence})
  .onConflictDoUpdate({target:communityPrivateStates.key,set:{revision:fact.revision,fact,journalSequence:record.sequence}});
 return record.sequence;
}
