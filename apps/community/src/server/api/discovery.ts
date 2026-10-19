import {Hono} from 'hono';
import type {AppEnv} from '../app-env';
import {socialStorage} from './community-social';
import {parseDiscoveryInput} from '@/shared/discovery-search';
import {searchPublic,suggestPublic} from '../discovery/search';
import {discoverPublic,authorDirectory,tagDirectory} from '../discovery/catalog';
import {HTTPException} from 'hono/http-exception';
function input(c:{req:{url:string}}){try{return parseDiscoveryInput(new URL(c.req.url).searchParams);}catch{throw new HTTPException(400);}}
export const discoveryRoutes=new Hono<AppEnv>().use(async(c,next)=>{c.header('cache-control','private, no-store');c.header('x-content-type-options','nosniff');await next();})
 .get('/search/suggestions',async c=>{const i=input(c);return c.json(await suggestPublic(socialStorage(c),i.filters.q));})
 .get('/search',async c=>c.json(await searchPublic(socialStorage(c),input(c))))
 .get('/discovery',async c=>c.json(await discoverPublic(socialStorage(c))))
 .get('/authors',async c=>c.json(await authorDirectory(socialStorage(c),{q:c.req.query('q'),cursor:c.req.query('cursor'),sort:c.req.query('sort')})))
 .get('/tags',async c=>c.json(await tagDirectory(socialStorage(c),{q:c.req.query('q'),cursor:c.req.query('cursor')})));
