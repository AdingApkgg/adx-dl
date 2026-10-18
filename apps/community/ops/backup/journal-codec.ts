/** Keep schema validation/order, but never hash defaults absent from an immutable legacy payload. */
export function preservePayloadShape<T>(parsed:T, original:unknown):T {
 if(Array.isArray(parsed))return parsed.map((value,index)=>preservePayloadShape(value,Array.isArray(original)?original[index]:undefined)) as T;
 if(parsed!==null&&typeof parsed==="object"){
  if(original===null||typeof original!=="object")throw new Error("STORAGE_JOURNAL_INVALID");
  return Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(original,key)).map(([key,value])=>[key,preservePayloadShape(value,(original as Record<string,unknown>)[key])])) as T;
 }
 return parsed;
}
/** Drain a nonempty byte-bounded prefix; a backlog larger than one segment must still make progress. */
export function journalBatchPrefix<T>(records:readonly T[],maxBytes=8*1024*1024):T[]{
 let bytes=2,count=0;
 for(const record of records){const next=Buffer.byteLength(JSON.stringify(record))+(count?1:0);if(bytes+next>maxBytes)break;bytes+=next;count++;}
 if(records.length&&!count)throw new Error("STORAGE_JOURNAL_RECORD_TOO_LARGE");
 return records.slice(0,count);
}
