import {expect,test} from "bun:test";
import {libraryDraft} from "./library";
import {privateLibraryFact} from "./private-library-journal";
import {downloadPlanItem,downloadPlanInput} from "./downloads";
const id="12345678-1234-4234-8234-123456789abc",at="2026-10-19T00:00:00.000Z";
const draft={name:"练习谱单",description:"",chartIds:[id]};
test("library validates bounded unique members and unicode names",()=>{expect(libraryDraft.safeParse(draft).success).toBe(true);for(const bad of [{...draft,name:"😀".repeat(61)},{...draft,chartIds:[id,id]},{...draft,description:"x".repeat(501)},{...draft,unknown:"private"}])expect(libraryDraft.safeParse(bad).success).toBe(false);});
test("deleted list is a minimal tombstone and cannot retain a public snapshot",()=>{const fact={version:1,entity:"list",id,userId:"owner",revision:2,publicId:"1",draft:null,publication:null,deleted:true,createdAt:at,updatedAt:at};expect(privateLibraryFact.safeParse(fact).success).toBe(true);expect(privateLibraryFact.safeParse({...fact,draft}).success).toBe(false);expect(privateLibraryFact.safeParse({...fact,version:2}).success).toBe(false);});
test("download plans are bounded and same-origin version constrained",()=>{const item={publicId:"1",versionId:id,size:9,sha256:"a".repeat(64),url:`/api/v1/charts/1/download?expectedVersion=${id}`};expect(downloadPlanItem.safeParse(item).success).toBe(true);expect(downloadPlanItem.safeParse({...item,url:"https://attacker.invalid/file"}).success).toBe(false);expect(downloadPlanInput.safeParse({publicIds:Array(51).fill("1")}).success).toBe(false);});
