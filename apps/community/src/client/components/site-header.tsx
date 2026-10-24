import {NavigationIndicator} from "./motion-ui";
import {CompassIcon,FileMusicIcon,LibraryIcon,MenuIcon,MessageSquareIcon,Music2Icon,SearchIcon,UploadIcon,ArrowUpRightIcon} from "lucide-react";
import {useQuery} from "@tanstack/react-query";
import {Link,useLocation} from "react-router";
import {Button} from "@astrodx/ui/components/button";
import {Sheet,SheetClose,SheetContent,SheetDescription,SheetHeader,SheetTitle,SheetTrigger} from "@astrodx/ui/components/sheet";
import {m} from "@/paraglide/messages.js";
import {deLocalizeHref,localizeHref} from "@/paraglide/runtime.js";
import {primarySection,workspaceSection} from "../lib/site-navigation";
import {getRenderApi} from "../lib/browser";
import {meQuery} from "../queries/me";
import {AccountMenu} from "./account-menu";
import {LanguageMenu,LanguageOptions} from "./language-menu";
import {SettingsSheet} from "./settings-sheet";
import {NotificationIndicator} from "./notification-indicator";
function primaryItems(){return [{key:"discover",href:"/",label:m.ui_nav_discover(),icon:CompassIcon},{key:"charts",href:"/charts",label:m.ui_nav_charts(),icon:FileMusicIcon},{key:"lists",href:"/lists",label:m.ui_nav_lists(),icon:LibraryIcon},{key:"forum",href:"/forum",label:m.site_forum(),icon:MessageSquareIcon}] as const;}
function MoreNavigation(){
 const groups=[{label:m.ui_group_explore(),items:[["/discover",m.discovery_title()],["/authors",m.discovery_authors()],["/tags",m.discovery_tags()],["/lists",m.library_public_title()]]},{label:m.ui_group_site(),items:[["/notices",m.site_notices()],["/help",m.site_help()],["/downloads",m.download_title()],["/privacy",m.privacy_link()]]}];
 return <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={m.ui_more()} title={m.ui_more()}><MenuIcon aria-hidden="true"/></Button></SheetTrigger><SheetContent closeLabel={m.appearance_close()} className="w-[min(90vw,24rem)] gap-6 overflow-y-auto p-6"><SheetHeader className="pr-8"><SheetTitle>{m.site_name()}</SheetTitle><SheetDescription>{m.ui_menu_hint()}</SheetDescription></SheetHeader>{groups.map(group=><nav key={group.label} aria-label={group.label} className="space-y-1"><p className="community-nav-label">{group.label}</p>{group.items.map(([href,label])=><SheetClose key={href} asChild><Link className="community-side-link" to={localizeHref(href)}>{label}</Link></SheetClose>)}</nav>)}<div className="space-y-4 border-t pt-4"><LanguageOptions/><div className="flex flex-wrap items-center gap-2"><SettingsSheet/><a className="community-side-link" href="https://adxdls.saop.cc">{m.ui_web_site()}<ArrowUpRightIcon aria-hidden="true" className="size-4"/></a></div></div></SheetContent></Sheet>;
}
export function SiteHeader(){
 const active=primarySection(deLocalizeHref(useLocation().pathname));
 const {data:me}=useQuery(meQuery(getRenderApi()));
 return <header className="community-header"><a href="#main-content" className="community-skip-link">{m.ui_skip_content()}</a><div className="community-header-inner"><Link to={localizeHref("/")} className="community-brand" aria-label={m.site_name()}><span className="community-brand-mark"><Music2Icon aria-hidden="true"/></span><span><span className="block text-sm font-bold tracking-tight">AstroDX</span><span className="block text-[11px] font-medium text-muted-foreground">{m.ui_brand_subtitle()}</span></span></Link><nav aria-label={m.site_navigation()} className="hidden items-center gap-1 lg:flex">{primaryItems().map(({key,href,label,icon:Icon})=><Link key={key} to={localizeHref(href)} aria-current={active===key?"page":undefined} className={`community-primary-link community-motion-nav ${active===key?"is-active":""}`}>{active===key?<NavigationIndicator group="primary"/>:null}<Icon aria-hidden="true"/>{label}</Link>)}</nav><div className="ml-auto flex shrink-0 items-center gap-0.5"><Button asChild variant="ghost" size="icon"><Link to={localizeHref("/search")} aria-label={m.discovery_search_label()} title={m.discovery_search_label()}><SearchIcon aria-hidden="true"/></Link></Button>{me?.status==="active"?<Button asChild size="sm" className="mr-1 hidden lg:inline-flex"><Link to={localizeHref("/me/charts/new")}><UploadIcon aria-hidden="true"/>{m.chart_new()}</Link></Button>:null}<NotificationIndicator compact/><div className="hidden items-center sm:flex"><LanguageMenu/><SettingsSheet/></div><AccountMenu/><MoreNavigation/></div></div></header>;
}
export function MobileNavigation(){
 const path=deLocalizeHref(useLocation().pathname),active=primarySection(path),{data:me}=useQuery(meQuery(getRenderApi()));
 const items=[...primaryItems().filter(i=>i.key!=="lists"),{key:"mine",href:me?.status==="pending_deletion"?"/account-deletion":"/me/library",label:m.ui_nav_mine(),icon:LibraryIcon}];
 return <nav aria-label={m.ui_mobile_navigation()} className="community-bottom-nav lg:hidden">{items.map(({key,href,label,icon:Icon})=><Link key={key} to={localizeHref(href)} aria-current={key==="mine"?workspaceSection(path)?"page":undefined:active===key?"page":undefined} className="community-bottom-link community-motion-nav">{(key==="mine"?Boolean(workspaceSection(path)):active===key)?<NavigationIndicator group="mobile"/>:null}<Icon aria-hidden="true"/><span>{label}</span></Link>)}</nav>;
}
