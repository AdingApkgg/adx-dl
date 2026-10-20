import { z } from "zod";
export const GOVERNANCE_PAGE_SIZE = 20;
export const APPEAL_LIMIT = 5;
export const governanceSource = z.enum(["chart", "discussion", "list"]);
export const appealStatus = z.enum(["open", "upheld", "review_required"]);
export const governanceText = (max:number) => z.string().max(max*2).transform(v=>v.trim()).refine(v=>[...v].length>=1&&[...v].length<=max)
 // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject stored control characters; line breaks and tabs are allowed.
 .refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(v));
export const decisionKeySchema = z.string().regex(/^(decision|chart):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const governanceQuerySchema = z.object({cursor:z.string().max(4096).optional(),source:governanceSource.optional(),status:z.enum(["open","resolved","all"]).optional(),kind:z.enum(["moderation","report_resolution","notice","featured","appeal_resolution"]).optional()}).strict();
export type GovernanceQuery = z.infer<typeof governanceQuerySchema>;
export const appealInputSchema=z.object({decisionKey:decisionKeySchema,reason:governanceText(1000)}).strict();
export const appealResolutionSchema=z.object({expectedRevision:z.number().int().min(1).max(2147483646),status:z.enum(["upheld","review_required"]),note:governanceText(500)}).strict();
export type AppealInput=z.infer<typeof appealInputSchema>;
export type AppealResolution=z.infer<typeof appealResolutionSchema>;
export type GovernancePage<T>={items:T[];nextCursor:string|null};
export type GovernanceTicket={id:string;source:z.infer<typeof governanceSource>;category:string;status:string;createdAt:string;href:string};
export type GovernanceDecision={key:string;entity:string;targetId:string;action:string;publicReason:string;createdAt:string;appealId:string|null};
export type GovernanceAppeal={id:string;decisionKey:string;reason:string;status:z.infer<typeof appealStatus>;revision:number;createdAt:string;resolvedAt:string|null;resolutionNote:string|null;publicReason:string|null};
export type GovernanceAudit={id:string;kind:string;action:string;targetType:string;targetId:string;actorPublicId:string|null;createdAt:string};
export type GovernanceOverview={reportsOpen:number;appealsOpen:number;overdue:number;oldestOpenAt:string|null;resolved24h:number;actions24h:number;generatedAt:string};
