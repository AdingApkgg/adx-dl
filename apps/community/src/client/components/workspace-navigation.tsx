import {BookOpenIcon,ChevronDownIcon,FileMusicIcon,FolderInputIcon,HeartIcon,LayoutDashboardIcon,LibraryIcon,MessageSquareIcon,SettingsIcon,ShieldCheckIcon,UserIcon,UsersIcon,BellIcon,RadioIcon,FlagIcon,type LucideIcon} from "lucide-react";
import {NavLink,useLocation} from "react-router";
import {m} from "@/paraglide/messages.js";
import {deLocalizeHref,localizeHref} from "@/paraglide/runtime.js";
import {workspaceSection} from "../lib/site-navigation";
type Item={href:string;label:string;icon:LucideIcon;end?:boolean};
export function WorkspaceNavigation(){
 const path=deLocalizeHref(useLocation().pathname),section=workspaceSection(path);
 const groups:{key:string;title:string;items:Item[]}[]=[
  {key:"library",title:m.ui_group_library(),items:[{href:"/me/library",label:m.library_title(),icon:LibraryIcon,end:true},{href:"/me/favorites",label:m.my_favorites(),icon:HeartIcon},{href:"/downloads",label:m.download_title(),icon:BookOpenIcon}]},
  {key:"create",title:m.ui_group_create(),items:[{href:"/me/workbench",label:m.author_workbench(),icon:LayoutDashboardIcon},{href:"/me/charts",label:m.charts_title(),icon:FileMusicIcon},{href:"/me/imports",label:m.author_imports(),icon:FolderInputIcon}]},
  {key:"community",title:m.ui_group_community(),items:[{href:"/me/feed",label:m.following_feed_title(),icon:RadioIcon},{href:"/me/following",label:m.following_title(),icon:UsersIcon},{href:"/me/notifications",label:m.site_notifications(),icon:BellIcon},{href:"/me/discussions",label:m.site_my_discussions(),icon:MessageSquareIcon},{href:"/me/governance",label:m.governance_my_title(),icon:ShieldCheckIcon},{href:"/me/reports",label:m.my_reports(),icon:FlagIcon}]},
  {key:"account",title:m.ui_group_account(),items:[{href:"/settings/profile",label:m.nav_profile(),icon:UserIcon},{href:"/settings/account",label:m.nav_account(),icon:SettingsIcon}]},
 ];
 const content=<>{groups.map(group=><nav key={group.key} aria-label={group.title} className="community-nav-group"><p className="community-nav-label">{group.title}</p>{group.items.map(({href,label,icon:Icon,end})=><NavLink key={href} end={end} to={localizeHref(href)} aria-label={`${label} · ${group.title}`} className={({isActive})=>`community-side-link ${isActive?"is-active":""}`}><Icon aria-hidden="true"/>{label}</NavLink>)}</nav>)}</>;
 return <aside className="community-workspace-nav"><div className="hidden lg:block"><p className="community-workspace-title">{m.ui_workspace()}</p>{content}</div><details key={path} className="community-mobile-sections lg:hidden"><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium">{groups.find(g=>g.key===section)?.title??m.ui_workspace()}<ChevronDownIcon className="size-4" aria-hidden="true"/></summary><div className="grid gap-3 border-t p-3 sm:grid-cols-2">{content}</div></details></aside>;
}
