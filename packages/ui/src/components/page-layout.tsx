import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";

/** Content layout shared by the pilot pages; text and routing stay in the app. */
export function PageShell({ className, ...props }: ComponentProps<"main">) {
  return <main id="main-content" className={cn("ui-page", className)} {...props} />;
}

export function PageHeader({ title, description, meta, children }: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div className="min-w-0 space-y-2">
        <h1 className="ui-page-title">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">{description}</p> : null}
      </div>
      {meta ? <p className="text-xs leading-relaxed text-muted-foreground">{meta}</p> : null}
      {children}
    </header>
  );
}

export function Surface({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("ui-surface", className)} {...props} />;
}
