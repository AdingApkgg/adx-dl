import {expect,test} from 'bun:test';
import routes from './routes';
test('every route uses a unique file-derived or explicit ID',()=>{
 const ids=new Set<string>();const walk=(entries:typeof routes)=>{for(const route of entries){const id=route.id??route.file;expect(ids.has(id)).toBe(false);ids.add(id);if(route.children)walk(route.children);}};walk(routes);
});
