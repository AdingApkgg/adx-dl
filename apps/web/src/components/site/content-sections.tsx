import { ArrowUpRightIcon } from "lucide-react";

import type { ContentBlock, ContentSection } from "@/lib/content-sections";

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "p":
      return <p className="leading-relaxed text-muted-foreground">{block.text}</p>;
    case "list":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          {block.items.map((item) => (
            <li key={item} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
          {block.items.map((item) => (
            <li key={item} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ol>
      );
    case "links":
      return (
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {block.items.map((item) => (
            <li key={item.url} className="leading-relaxed">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                {item.label}
                <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
              </a>
              {item.note ? <span className="text-muted-foreground"> — {item.note}</span> : null}
            </li>
          ))}
        </ul>
      );
  }
}

/** Renders /about-style section lists with stable heading anchors. */
export function ContentSections({ sections }: { sections: ContentSection[] }) {
  return (
    <div className="flex flex-col gap-10">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="flex scroll-mt-24 flex-col gap-3">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </div>
  );
}
