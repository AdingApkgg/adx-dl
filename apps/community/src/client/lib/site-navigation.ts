type PrimarySection = "discover" | "charts" | "lists" | "forum";
type WorkspaceSection = "library" | "create" | "community" | "account";
function within(path:string,root:string){return path===root||path.startsWith(`${root}/`);}
export function primarySection(path:string):PrimarySection|null {
 path=path.replace(/\/+$/,"")||"/";
 if(path==="/"||within(path,"/discover"))return "discover";
 if(["/charts","/search","/authors","/tags"].some(root=>within(path,root)))return "charts";
 if(within(path,"/lists"))return "lists";
 if(within(path,"/forum"))return "forum";
 return null;
}
export function workspaceSection(path:string):WorkspaceSection|null {
 path=path.replace(/\/+$/,"")||"/";
 if(["/me/charts","/me/workbench","/me/imports"].some(root=>within(path,root)))return "create";
 if(["/me/library","/me/lists","/me/favorites","/downloads"].some(root=>within(path,root)))return "library";
 if(["/me/feed","/me/following","/me/discussions","/me/notifications","/me/reports","/me/governance"].some(root=>within(path,root)))return "community";
 if(within(path,"/settings"))return "account";
 return null;
}
