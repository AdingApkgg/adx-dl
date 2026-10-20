import { type ApiClient, okJson } from "@/shared/api-client";
import type { AppealInput, AppealResolution, GovernanceAppeal, GovernanceAudit, GovernanceDecision, GovernanceOverview, GovernancePage, GovernanceQuery, GovernanceTicket } from "@/shared/governance";
export function governanceApi(api:ApiClient){
 const r=api.api.v1.governance,fresh={init:{cache:"no-store" as const}};
 return {
  decisions:async(cursor?:string):Promise<GovernancePage<GovernanceDecision>>=>okJson(await r.me.decisions.$get({query:cursor?{cursor}:{}},fresh)),
  appeals:async(query:Pick<GovernanceQuery,"cursor"|"status">={}):Promise<GovernancePage<GovernanceAppeal>>=>okJson(await r.me.appeals.$get({query},fresh)),
  create:async(json:AppealInput):Promise<GovernanceAppeal>=>okJson(await r.me.appeals.$post({json},fresh)),
  overview:async():Promise<GovernanceOverview>=>okJson(await r.dash.overview.$get(undefined,fresh)),
  tickets:async(query:Omit<GovernanceQuery,"kind">={}):Promise<GovernancePage<GovernanceTicket>>=>okJson(await r.dash.tickets.$get({query},fresh)),
  audit:async(query:Pick<GovernanceQuery,"cursor"|"kind">={}):Promise<GovernancePage<GovernanceAudit>>=>okJson(await r.dash.audit.$get({query},fresh)),
  staffAppeals:async(query:Pick<GovernanceQuery,"cursor"|"status">={}):Promise<GovernancePage<GovernanceAppeal>>=>okJson(await r.dash.appeals.$get({query},fresh)),
  resolve:async(id:string,json:AppealResolution):Promise<GovernanceAppeal>=>okJson(await r.dash.appeals[":id"].resolution.$post({param:{id},json},fresh)),
 };
}
