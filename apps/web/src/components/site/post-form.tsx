"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";

type FieldName = "songTitle" | "source";

/**
 * Chart submission form: composes the entries into a formatted message and
 * hands it to the guestbook via `?draft=`, where GuestbookPrefill drops it
 * into the Artalk editor — posting the comment completes the submission.
 */
export function PostForm({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale).post;
  const router = useRouter();
  const [songTitle, setSongTitle] = React.useState("");
  const [source, setSource] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<FieldName[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const songTitleRef = React.useRef<HTMLInputElement>(null);
  const sourceRef = React.useRef<HTMLInputElement>(null);

  const invalid = (field: FieldName): boolean => errors.includes(field);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const missing: FieldName[] = [];
      if (!songTitle.trim()) missing.push("songTitle");
      if (!source.trim()) missing.push("source");
      setErrors(missing);
      if (missing.length > 0) {
        // A single generic message at the bottom of a noValidate form leaves
        // the user hunting for which field it means — and never moves focus,
        // so a screen-reader user hears nothing at all. Land on the first one.
        const first = missing[0] === "songTitle" ? songTitleRef : sourceRef;
        first.current?.focus();
        return;
      }
      const lines = [
        dictionary.composedTitle,
        `${dictionary.songTitleLabel}: ${songTitle.trim()}`,
        `${dictionary.sourceLabel}: ${source.trim()}`,
      ];
      if (notes.trim()) {
        lines.push(`${dictionary.notesLabel}: ${notes.trim()}`);
      }
      const draft = lines.join("\n");
      // The guestbook is a separate route, so the submit button has to say that
      // something is happening; otherwise a slow navigation reads as a dead
      // click and the form gets submitted twice.
      setSubmitting(true);
      router.push(
        `${buildLocalePath("/comments", locale)}?draft=${encodeURIComponent(draft)}`
      );
    },
    [dictionary, locale, notes, router, songTitle, source]
  );

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.songTitleLabel}
            <Input
              ref={songTitleRef}
              required
              value={songTitle}
              onChange={(event) => setSongTitle(event.target.value)}
              placeholder={dictionary.songTitlePlaceholder}
              aria-invalid={invalid("songTitle") ? true : undefined}
              aria-describedby={invalid("songTitle") ? "post-song-title-error" : undefined}
            />
            {invalid("songTitle") ? (
              <span id="post-song-title-error" className="text-sm font-normal text-destructive">
                {dictionary.songTitleRequired}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.sourceLabel}
            <Input
              ref={sourceRef}
              required
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={dictionary.sourcePlaceholder}
              aria-invalid={invalid("source") ? true : undefined}
              aria-describedby={invalid("source") ? "post-source-error" : undefined}
            />
            {invalid("source") ? (
              <span id="post-source-error" className="text-sm font-normal text-destructive">
                {dictionary.sourceRequired}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.notesLabel}
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={dictionary.notesPlaceholder}
            />
          </label>
          {/* Always mounted so the summary is announced when it appears; the
              per-field messages above carry the specifics. */}
          <p role="alert" className="text-sm text-destructive empty:hidden">
            {errors.length > 0 ? dictionary.requiredHint : ""}
          </p>
          <Button type="submit" className="w-fit" disabled={submitting}>
            <SendIcon data-icon="inline-start" aria-hidden="true" />
            {submitting ? dictionary.submitting : dictionary.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
