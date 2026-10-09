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
    { id: "account", title: m.privacy_login_heading(), paragraphs: [m.privacy_google(), m.privacy_qq(), m.privacy_passkey(), m.privacy_profile()] },
    { id: "security", title: m.privacy_security_heading(), paragraphs: [m.privacy_session(), m.privacy_preferences()] },
    { id: "analytics", title: m.privacy_analytics_heading(), paragraphs: [m.privacy_analytics(), m.privacy_analytics_disabled()] },
    { id: "services", title: m.privacy_services_heading(), paragraphs: [m.privacy_services()] },
    { id: "deletion", title: m.privacy_deletion_heading(), paragraphs: [m.privacy_manage(), m.privacy_delete(), m.privacy_backups()] },
  ];

  return (
    <main className="space-y-6">
      <PageTitle description={m.privacy_updated()}>{m.privacy_title()}</PageTitle>
      <p>{m.privacy_intro()}</p>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="space-y-3">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <section id="contact" className="space-y-3">
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
    </main>
  );
}
