"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";

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
  const [showHint, setShowHint] = React.useState(false);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!songTitle.trim() || !source.trim()) {
        setShowHint(true);
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
              required
              value={songTitle}
              onChange={(event) => setSongTitle(event.target.value)}
              placeholder={dictionary.songTitlePlaceholder}
              aria-invalid={showHint && !songTitle.trim() ? true : undefined}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.sourceLabel}
            <Input
              required
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={dictionary.sourcePlaceholder}
              aria-invalid={showHint && !source.trim() ? true : undefined}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.notesLabel}
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={dictionary.notesPlaceholder}
            />
          </label>
          {showHint && (!songTitle.trim() || !source.trim()) ? (
            <p role="alert" className="text-sm text-destructive">
              {dictionary.requiredHint}
            </p>
          ) : null}
          <Button type="submit" className="w-fit">
            <SendIcon data-icon="inline-start" aria-hidden="true" />
            {dictionary.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
