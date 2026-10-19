import {sql} from "drizzle-orm";
import {privateLibraryFact,type PrivateLibraryFact} from "@/shared/private-library-journal";
import type {DbTransaction} from "../storage/contracts";
import {communityHash} from "../community/content-journal";
import {storageTombstones} from "../db/schema";
import {rows} from "../discussions/core";
export {awaitChartJournal as awaitLibraryJournal} from "../charts/publication-journal";
/** Caller owns account/list lock; control/account keys have independent revisions. */
export async function recordLibraryFact(tx:DbTransaction,input:PrivateLibraryFact){const fact=privateLibraryFact.parse(input),key=`${fact.entity}:${fact.id}`;const [old]=await rows<{revision:number;fact:PrivateLibraryFact;journal_sequence:number}>(tx,sql`select * from chart_library_states where key=${key}`);if(old){if(old.revision===fact.revision&&communityHash(old.fact)===communityHash(fact))return Number(old.journal_sequence);if(old.revision>=fact.revision)throw new Error("PRIVATE_LIBRARY_FACT_CONFLICT");}
 const [r]=await tx.insert(storageTombstones).values({kind:"private_library",payload:fact}).returning({sequence:storageTombstones.sequence});if(!r)throw new Error("PRIVATE_LIBRARY_FACT_MISSING");
 await tx.execute(sql`insert into chart_library_states(key,revision,fact,journal_sequence) values(${key},${fact.revision},${JSON.stringify(fact)}::jsonb,${r.sequence}) on conflict(key) do update set revision=excluded.revision,fact=excluded.fact,journal_sequence=excluded.journal_sequence`);
 if(fact.entity==="list"&&fact.publicId)await tx.execute(sql`insert into chart_list_public_ids(list_id,public_id) values(${fact.id}::uuid,${fact.publicId}::bigint) on conflict(list_id) do nothing`);
 if(fact.entity==="list")await tx.execute(sql`insert into chart_lists(id,owner_id,revision,public_id,fact,journal_sequence,updated_at,published_at) values(${fact.id}::uuid,${fact.userId},${fact.revision},${fact.publicId}::bigint,${JSON.stringify(fact)}::jsonb,${r.sequence},${fact.updatedAt}::timestamptz,${fact.publication?.publishedAt??null}::timestamptz) on conflict(id) do update set revision=excluded.revision,public_id=excluded.public_id,fact=excluded.fact,journal_sequence=excluded.journal_sequence,updated_at=excluded.updated_at,published_at=excluded.published_at`);
 else if(fact.entity==="list_control")await tx.execute(sql`insert into chart_list_controls(id,revision,fact,journal_sequence) values(${fact.id}::uuid,${fact.revision},${JSON.stringify(fact)}::jsonb,${r.sequence}) on conflict(id) do update set revision=excluded.revision,fact=excluded.fact,journal_sequence=excluded.journal_sequence`);
 else await tx.execute(sql`insert into chart_library_accounts(user_id,revision,journal_sequence) values(${fact.id},${fact.revision},${r.sequence}) on conflict(user_id) do update set revision=excluded.revision,journal_sequence=excluded.journal_sequence`);
 return r.sequence;
}
