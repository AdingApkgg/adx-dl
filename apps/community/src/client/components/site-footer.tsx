import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
export function SiteFooter(){return <footer className="community-footer"><div className="flex min-w-0 flex-col gap-1"><p className="text-sm font-semibold">{m.site_name()}</p><p className="text-xs leading-5 text-muted-foreground">{m.ui_footer_hint()}</p></div><nav aria-label={m.ui_group_site()} className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><Link to={localizeHref("/help")}>{m.site_help()}</Link><Link to={localizeHref("/notices")}>{m.site_notices()}</Link><Link to={localizeHref("/privacy")}>{m.privacy_link()}</Link><a href="https://adxdls.saop.cc">{m.ui_web_site()}</a></nav></footer>;}
