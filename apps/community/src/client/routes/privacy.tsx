import { m } from "@/paraglide/messages.js";
import { requestMetaContext } from "@/shared/router-context";

import { PageTitle, textLinkClass } from "../components/page-title";
import { canonicalLink, localeAlternates, originFrom } from "../lib/seo";
import type { Route } from "./+types/privacy";

export function loader({ context }: Route.LoaderArgs) {
  return { contactEmail: context.get(requestMetaContext).publicContactEmail ?? null };
}

export function meta({ matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  return [
    { title: `${m.privacy_title()} - ${m.site_name()}` },
    { name: "description", content: m.privacy_description() },
    canonicalLink(origin, location.pathname),
    ...localeAlternates(origin, location.pathname),
  ];
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  const sections = [
    { id: "account", title: m.privacy_login_heading(), paragraphs: [m.privacy_google(), m.privacy_awmc(), m.privacy_qq(), m.privacy_passkey(), m.privacy_profile()] },
    { id: "author", title: m.author_workbench(), paragraphs: [m.author_privacy()] },
    { id: "security", title: m.privacy_security_heading(), paragraphs: [m.privacy_session(), m.privacy_preferences()] },
    { id: "analytics", title: m.privacy_analytics_heading(), paragraphs: [m.privacy_analytics(), m.privacy_analytics_disabled()] },
    { id: "services", title: m.privacy_services_heading(), paragraphs: [m.privacy_services()] },
    { id: "deletion", title: m.privacy_deletion_heading(), paragraphs: [m.privacy_manage(), m.privacy_delete(), m.privacy_backups()] },
  ];

  return (
    <main className="community-reading community-policy-page space-y-6">
      <PageTitle description={m.privacy_updated()}>{m.privacy_title()}</PageTitle>
      <p className="community-context-note">{m.privacy_intro()}</p>
      <nav aria-label={m.ui_content_navigation()} className="community-content-nav">{sections.map(section=><a key={section.id} href={`#${section.id}`}>{section.title}</a>)}<a href="#governance">{m.governance_my_title()}</a><a href="#contact">{m.privacy_contact_heading()}</a><a href="#search">{m.discovery_search_label()}</a><a href="#community">{m.site_help_community_title()}</a></nav>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="community-policy-section space-y-3">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <section id="governance" className="community-policy-section space-y-3"><h2 className="text-lg font-semibold">{m.governance_my_title()}</h2><p>{m.governance_privacy()}</p></section>
      <section id="contact" className="community-policy-section space-y-3">
        <h2 className="text-lg font-semibold">{m.privacy_contact_heading()}</h2>
        <p>
          {loaderData.contactEmail ? (
            <>
              {m.privacy_contact_intro()}{" "}
              <a href={`mailto:${loaderData.contactEmail}`} className={textLinkClass}>{loaderData.contactEmail}</a>
            </>
          ) : m.privacy_contact_unavailable()}
        </p>
      </section>
    <section id="search" className="community-policy-section space-y-3"><h2 className="font-semibold">{m.discovery_search_label()}</h2><p className="whitespace-pre-line">{m.discovery_privacy()}</p></section>
    <section id="community" className="community-policy-section space-y-3"><h2 className="font-semibold">{m.site_help_community_title()}</h2><p className="whitespace-pre-line">{m.site_help_community_body()}</p></section></main>
  );
}
