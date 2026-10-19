import type {ChartVersionDto} from "@/shared/charts";
import type {StatementDiff} from "./compare";
import type {compareFingerprints} from "./compare";
/** Only numbers and fixed labels; no source text, private paths, unverified fixes or quality claims. */
export function releaseNoteDraft(left:ChartVersionDto|undefined,right:ChartVersionDto,assets:ReturnType<typeof compareFingerprints>|null,diff:StatementDiff|null,locale:string):string{
 const words=locale==="en"?{version:"Version",initial:"Initial release",difficulty:"Difficulty",added:"added",removed:"removed",updated:"summary changed",assets:"Preview assets changed",hunks:"Text change blocks",limited:"Fine source comparison unavailable"}:locale==="ja"?{version:"バージョン",initial:"初回公開",difficulty:"難易度",added:"追加",removed:"削除",updated:"概要変更",assets:"プレビュー素材の変更",hunks:"テキスト差分ブロック",limited:"詳細ソース比較は未完了"}:{version:"版本",initial:"首次发布",difficulty:"难度",added:"新增",removed:"移除",updated:"摘要变化",assets:"预览资产变化",hunks:"文本差异块",limited:"精细源码对照未完成"};
 const lines=[left?`${words.version} ${left.ordinal} → ${right.ordinal}`:`${words.initial} · ${words.version} ${right.ordinal}`];
 const old=new Map((left?.summary.difficulties??[]).map(d=>[d.difficulty,d])),next=new Map(right.summary.difficulties.map(d=>[d.difficulty,d]));
 for(const key of [...new Set([...old.keys(),...next.keys()])].sort()){const a=old.get(key),b=next.get(key);if(!a)lines.push(`${words.difficulty} ${key}: ${words.added}`);else if(!b)lines.push(`${words.difficulty} ${key}: ${words.removed}`);else if(JSON.stringify(a)!==JSON.stringify(b))lines.push(`${words.difficulty} ${key}: ${words.updated}${a.noteCount!==null&&b.noteCount!==null?` (${a.noteCount} → ${b.noteCount})`:""}`);}
 if(assets){const changed=assets.roles.filter(r=>!r.same).map(r=>r.role);if(changed.length)lines.push(`${words.assets}: ${changed.join(", ")}`);}
 if(diff)lines.push(diff.complete?`${words.hunks}: ${diff.hunks.length}`:words.limited);
 return Array.from(lines.join("\n")).slice(0,1000).join("");
}
