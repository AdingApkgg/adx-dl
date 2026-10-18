import type { Client } from "pg";
import { communityContentFact } from "../../src/shared/community-content-journal";
import type { JournalRecord } from "./journal";
export async function replayCommunityContent(c: Client, record: JournalRecord) {
  const fact = communityContentFact.parse(record.payload), key = `${fact.entity}:${fact.id}`;
  const prior = await c.query("select fact,revision,journal_sequence from community_content_states where key=$1 for update",[key]);
  if (prior.rowCount) {
    const old = communityContentFact.parse(prior.rows[0].fact);
    if (old.revision > fact.revision) return;
    if (old.revision === fact.revision && JSON.stringify(old) !== JSON.stringify(fact)) throw new Error("COMMUNITY_JOURNAL_CONFLICT");
    if (old.revision < fact.revision && (["hidden","deleted"].includes(old.state) || (old.state==="root_removed" && fact.state!=="hidden"))) throw new Error("COMMUNITY_CONTENT_REVIVAL");
  }
  if (fact.entity === "forum_id") {
    const exists = await c.query("select public_id::text as id from forum_public_ids where topic_id=$1",[fact.id]);
    if (exists.rowCount && exists.rows[0].id !== fact.publicId) throw new Error("FORUM_PUBLIC_ID_CONFLICT");
    await c.query(`insert into forum_public_ids(topic_id,public_id,journal_sequence) overriding system value values($1,$2,$3)
      on conflict(topic_id) do update set journal_sequence=greatest(forum_public_ids.journal_sequence,excluded.journal_sequence)`,[fact.id,fact.publicId,record.sequence]);
  }
  await c.query(`insert into community_content_states(key,entity,entity_id,revision,fact,journal_sequence)
    values($1,$2,$3,$4,$5,$6) on conflict(key) do update set revision=excluded.revision,fact=excluded.fact,journal_sequence=excluded.journal_sequence,updated_at=clock_timestamp()
    where community_content_states.journal_sequence<=excluded.journal_sequence`,[key,fact.entity,fact.id,fact.revision,JSON.stringify(fact),record.sequence]);
}
export async function finishCommunityReplay(c: Client, durable: number) {
  const ahead = await c.query(`select 1 from community_content_states where journal_sequence>$1 union all select 1 from forum_public_ids where journal_sequence>$1 limit 1`,[durable]);
  if (ahead.rowCount) throw new Error("COMMUNITY_UNEXPORTED_STATE");
  // Old delivery evidence may be absent in an old backup. Never dispatch snapshot-era events again.
  await c.query("update discussion_outbox set completed=true where not completed");
  await c.query(`select setval('forum_public_ids_public_id_seq',coalesce(max(public_id),1),count(*)>0) from forum_public_ids`);
}
