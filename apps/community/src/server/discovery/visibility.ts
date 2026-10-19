import {sql,type SQL} from 'drizzle-orm';
import {charts,chartVersions,chartPublications,chartPublicIds,files,user,userPublicIds} from '../db/schema';
import {publicChartVisibilityQuery,publicChartAllowed} from '../charts/publication';
import type {StorageContext} from '../storage/contracts';
import {publicListAllowed} from '../library/core';
import {visible,topicAllowed,effectiveBoard,exported} from '../discussions/core';
import type {SearchType} from '@/shared/discovery-search';
const field=(kind:string,value:SQL)=>sql`jsonb_build_object('kind',${kind},'value',coalesce(${value},''))`;
/** Single live chart authority used by search, facets, directories, random and XML. */
export function chartRelation(ctx:StorageContext):SQL {
 const author=sql`case when ${userPublicIds.journalSequence}<=${exported} and ${user.status}='active' then jsonb_build_object('id',${user.id},'publicId',${userPublicIds.publicId}::text,'name',${user.name},'image',${user.image}) else null end`;
 const authorName=sql`case when ${userPublicIds.journalSequence}<=${exported} and ${user.status}='active' then ${user.name} else '' end`;
 const json=sql`jsonb_build_object('id',${charts.id},'publicId',${chartPublicIds.publicId}::text,'versionId',${chartPublications.versionId},'ordinal',${chartVersions.ordinal},'title',${chartPublications.title},'artist',${chartPublications.artist},'description',${chartPublications.description},'credits',${chartPublications.credits},'tags',${chartPublications.tags},'aliases',${chartPublications.aliases},'releaseNote',${chartPublications.releaseNote},'publishedAt',to_char(${chartPublications.publishedAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(${chartPublications.updatedAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'summary',${chartVersions.summary},'sourceSize',${files.size},'author',${author})`;
 const fields=sql`jsonb_build_array(${field('id',sql`${chartPublicIds.publicId}::text`)},${field('title',chartPublications.title)},${field('artist',chartPublications.artist)},${field('author',authorName)})
 ||coalesce((select jsonb_agg(jsonb_build_object('kind','alias','value',a)) from jsonb_array_elements_text(${chartPublications.aliases}) a),'[]'::jsonb)
 ||coalesce((select jsonb_agg(jsonb_build_object('kind','tag','value',t->>'label')) from jsonb_array_elements(${chartPublications.tags}) t),'[]'::jsonb)
 ||coalesce((select jsonb_agg(jsonb_build_object('kind','designer','value',d->>'designer')) from jsonb_array_elements(${chartVersions.summary}->'difficulties') d where coalesce(d->>'designer','')<>''),'[]'::jsonb)`;
 const q=publicChartVisibilityQuery(ctx.db.select({id:sql`${charts.id}::text`.as('id'),public_id:sql`${chartPublicIds.publicId}::text`.as('public_id'),owner_id:sql`${charts.ownerId}`.as('owner_id'),title:sql`${chartPublications.title}`.as('title'),description:sql`${chartPublications.artist}`.as('description'),at:sql`${chartPublications.updatedAt}`.as('at'),published:sql`${chartPublications.publishedAt}`.as('published'),data:json.as('data'),fields:fields.as('fields')}).from(chartPublications).$dynamic()).where(publicChartAllowed());
 return q.getSQL();
}
export function listRelation():SQL {
 return sql`select l.id::text,l.public_id::text,l.owner_id,pub->>'name' title,pub->>'description' description,l.published_at at,l.published_at published,
 jsonb_build_object('publicId',l.public_id::text,'revision',(pub->>'revision')::integer,'name',pub->>'name','description',pub->>'description','publishedAt',pub->>'publishedAt','author',jsonb_build_object('publicId',p.public_id::text,'name',u.name,'image',u.image),'total',jsonb_array_length(pub->'chartIds')) data,
 jsonb_build_array(${field('id',sql`l.public_id::text`)},${field('title',sql`pub->>'name'`)},${field('author',sql`u.name`)},${field('body',sql`pub->>'description'`)}) fields
 from chart_lists l join "user" u on u.id=l.owner_id join user_public_ids p on p.user_id=u.id cross join lateral(select l.fact->'publication' pub) x where ${publicListAllowed()}`;
}
export function topicRelation():SQL {
 return sql`select t.id::text,p.public_id::text,t.author_id owner_id,t.title,t.body description,coalesce(t.edited_at,t.created_at) at,t.created_at published,
 jsonb_build_object('publicId',p.public_id::text,'boardId',${effectiveBoard()},'title',t.title,'description',left(t.body,120)) data,
 jsonb_build_array(${field('id',sql`p.public_id::text`)},${field('title',sql`t.title`)},${field('author',sql`case when up.journal_sequence<=${exported} then u.name else '' end`)},${field('body',sql`t.body`)}) fields
 from discussion_topics t join forum_public_ids p on p.topic_id=t.id join "user" u on u.id=t.author_id left join user_public_ids up on up.user_id=u.id
 where ${visible('topic','t')} and ${topicAllowed()} and t.title is not null and p.journal_sequence<=${exported} and not exists(select 1 from community_content_states ctl where ctl.key='topic_control:'||t.id::text and coalesce((ctl.fact->'controls'->>'removedRoot')::boolean,false))`;
}
export function authorRelation(ctx:StorageContext):SQL {
 return sql`with contributions as (select owner_id,at from (${chartRelation(ctx)}) c where owner_id is not null union all select owner_id,at from (${listRelation()}) l union all select owner_id,at from (${topicRelation()}) t), contribution as (select owner_id,count(*)::integer n,max(at) at from contributions group by owner_id)
 select u.id,p.public_id::text,u.id owner_id,u.name title,coalesce(pr.bio,'') description,c.at,u.created_at published,
 jsonb_build_object('publicId',p.public_id::text,'name',u.name,'bio',left(coalesce(pr.bio,''),120),'image',u.image,'count',c.n) data,
 jsonb_build_array(${field('id',sql`p.public_id::text`)},${field('title',sql`u.name`)},${field('body',sql`coalesce(pr.bio,'')`)}) fields
 from contribution c join "user" u on u.id=c.owner_id join user_public_ids p on p.user_id=u.id left join profiles pr on pr.user_id=u.id where u.status='active' and p.journal_sequence<=${exported}`;
}
export function entityRelation(ctx:StorageContext,type:SearchType):SQL {
 if(type==='charts')return chartRelation(ctx);if(type==='lists')return listRelation();if(type==='topics')return topicRelation();return authorRelation(ctx);
}
