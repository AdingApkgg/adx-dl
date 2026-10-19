import {expect,test,spyOn} from 'bun:test';
import {snapshot,groupSavepoint} from './query';
import type {StorageContext} from '../storage/contracts';
import {StorageError} from '../storage/errors';
test('aggregate deadline keeps completed groups and marks unfinished work unavailable',async()=>{
 let clock=0;const now=spyOn(performance,'now').mockImplementation(()=>clock);
 const db={execute:async()=>({rows:[]}),transaction:async(run:(tx:unknown)=>unknown)=>run(db)},ctx={db} as unknown as StorageContext;
 try{
 const result=await snapshot(ctx,async(tx,deadline)=>{const first=await groupSavepoint(tx,'charts',deadline,async()=>({items:['safe']}));const last=await groupSavepoint(tx,'topics',deadline,async()=>{clock=2600;return {items:['late']};});return {first,last};},{partial:true});
 expect(result).toEqual({first:{items:['safe']},last:null});
 clock=0;await expect(snapshot(ctx,async()=>{clock=2600;return 'late';})).rejects.toMatchObject({status:503});
 clock=0;await expect(snapshot(ctx,async()=>{throw new StorageError(404,'NOT_FOUND');})).rejects.toMatchObject({status:404});
 }finally{now.mockRestore();}
});
