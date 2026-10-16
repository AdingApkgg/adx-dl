import type { Client } from "pg";
import { userPublicIdFact } from "../../src/shared/user-journal";
import type { JournalRecord } from "./journal";

/** Reserve even missing/deleted users. A URL reservation must never recreate an account. */
export async function replayUserPublicId(c: Client, record: JournalRecord) {
  const { publicId } = userPublicIdFact.parse(record.payload);
  if (!record.userId) throw new Error("USER_PUBLIC_ID_CONFLICT");
  const current = await c.query("select public_id::text as id from user_public_ids where user_id=$1", [record.userId]);
  if (current.rowCount && current.rows[0].id !== publicId) throw new Error("USER_PUBLIC_ID_CONFLICT");
  await c.query(`insert into user_public_ids(user_id,public_id,journal_sequence) overriding system value values($1,$2,$3)
    on conflict(user_id) do update set journal_sequence=greatest(user_public_ids.journal_sequence,excluded.journal_sequence)`,
    [record.userId, publicId, record.sequence]);
  await c.query(`select setval('user_public_ids_public_id_seq',
    greatest((select last_value from user_public_ids_public_id_seq),$1::bigint),true)`, [publicId]);
}

/** Check snapshot outboxes BEFORE either chart or user restoration appends trusted new facts. */
export async function checkRestoredUserIds(c: Client, durableSequence: number) {
  if ((await c.query(`select 1 from user_public_ids where journal_sequence>$1 union all
    select 1 from storage_tombstones where sequence>$1 and kind='user_public_id' limit 1`, [durableSequence])).rowCount)
    throw new Error("STORAGE_RESTORE_CLOSED");
  const missing = await c.query(`select 1 from "user" u left join user_public_ids i on i.user_id=u.id
    where i.user_id is null limit 1`);
  if (missing.rowCount && (await c.query("select 1 from storage_tombstones where sequence>$1 limit 1", [durableSequence])).rowCount)
    throw new Error("STORAGE_RESTORE_CLOSED");
}

/** Called after final account-deletion replay; only surviving legacy users get fresh URLs. */
export async function numberRestoredUsers(c: Client) {
  const missing = await c.query(`select u.id from "user" u left join user_public_ids i on i.user_id=u.id
    where i.user_id is null order by u.created_at,u.id`);
  for (const row of missing.rows) await c.query("select allocate_user_public_id($1)", [row.id]);
}
