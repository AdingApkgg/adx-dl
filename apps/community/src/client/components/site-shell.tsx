import {RouteMotion} from "./motion-ui";
import type {ReactNode} from "react";
import {useLocation} from "react-router";
import {useQuery} from "@tanstack/react-query";
import {deLocalizeHref} from "@/paraglide/runtime.js";
import {getRenderApi} from "../lib/browser";
import {meQuery} from "../queries/me";
import {workspaceSection} from "../lib/site-navigation";
import {DownloadDock} from "./download-actions";
import {LibrarySelectionBar} from "./library-actions";
import {LocaleSuggestion} from "./locale-suggestion";
import {MobileNavigation,SiteHeader} from "./site-header";
import {SiteFooter} from "./site-footer";
import {WorkspaceNavigation} from "./workspace-navigation";
export function SiteShell({children}:{children:ReactNode}){
 const path=deLocalizeHref(useLocation().pathname),{data:me}=useQuery(meQuery(getRenderApi()));
 const workspace=Boolean(workspaceSection(path)&&me?.status==="active");
 const wide=workspace||path==="/"||["/charts","/discover","/search","/authors","/tags","/lists","/dash","/forum"].some(root=>path===root||path.startsWith(`${root}/`));
 return <div className="community-shell"><SiteHeader/><LocaleSuggestion/><div className={`community-layout ${wide?"is-wide":""} ${workspace?"is-workspace":""}`}>{workspace?<WorkspaceNavigation/>:null}<div id="main-content" tabIndex={-1} className="community-content">{path!=="/downloads"?<LibrarySelectionBar/>:null}<RouteMotion>{children}</RouteMotion></div></div><DownloadDock/><SiteFooter/><MobileNavigation/></div>;
}
