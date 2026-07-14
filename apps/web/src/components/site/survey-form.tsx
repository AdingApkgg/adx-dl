"use client";

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";

/**
 * Site survey: composes the answers into a formatted message and hands it to
 * the guestbook via `?draft=` (same flow as the chart submission form).
 */
export function SurveyForm({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale).survey;
  const router = useRouter();
  const [platform, setPlatform] = React.useState("");
  const [discover, setDiscover] = React.useState("");
  const [satisfaction, setSatisfaction] = React.useState("");
  const [wish, setWish] = React.useState("");
  const [other, setOther] = React.useState("");
  const [showHint, setShowHint] = React.useState(false);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!platform || !satisfaction) {
        setShowHint(true);
        return;
      }
      // Compose from the option labels, not the raw select values — the two
      // differ (e.g. value "iOS" → label "iOS / iPadOS"), so using the value
      // would drop the qualifier the user actually picked.
      const platformLabel =
        dictionary.platformOptions.find((option) => option.value === platform)?.label ?? platform;
      const satisfactionLabel =
        dictionary.satisfactionOptions.find((option) => option.value === satisfaction)?.label ??
        satisfaction;
      const lines = [
        dictionary.composedTitle,
        `${dictionary.platformLabel} ${platformLabel}`,
        `${dictionary.satisfactionLabel} ${satisfactionLabel}`,
      ];
      if (discover.trim()) {
        lines.push(`${dictionary.discoverLabel} ${discover.trim()}`);
      }
      if (wish.trim()) {
        lines.push(`${dictionary.wishLabel} ${wish.trim()}`);
      }
      if (other.trim()) {
        lines.push(`${dictionary.otherLabel} ${other.trim()}`);
      }
      const draft = lines.join("\n");
      router.push(
        `${buildLocalePath("/comments", locale)}?draft=${encodeURIComponent(draft)}`
      );
    },
    [dictionary, discover, locale, other, platform, router, satisfaction, wish]
  );

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            {/* Radix's trigger is a <button>, not associable via <label>, so the
                question text is linked by id → aria-labelledby for AT. */}
            <span id="survey-platform-label">{dictionary.platformLabel}</span>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger
                className="w-full"
                aria-labelledby="survey-platform-label"
                aria-invalid={showHint && !platform ? true : undefined}
              >
                <SelectValue placeholder={dictionary.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {dictionary.platformOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            <span id="survey-satisfaction-label">{dictionary.satisfactionLabel}</span>
            <Select value={satisfaction} onValueChange={setSatisfaction}>
              <SelectTrigger
                className="w-full"
                aria-labelledby="survey-satisfaction-label"
                aria-invalid={showHint && !satisfaction ? true : undefined}
              >
                <SelectValue placeholder={dictionary.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {dictionary.satisfactionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.discoverLabel}
            <Input
              value={discover}
              onChange={(event) => setDiscover(event.target.value)}
              placeholder={dictionary.discoverPlaceholder}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.wishLabel}
            <Textarea
              value={wish}
              onChange={(event) => setWish(event.target.value)}
              placeholder={dictionary.wishPlaceholder}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {dictionary.otherLabel}
            <Textarea
              value={other}
              onChange={(event) => setOther(event.target.value)}
              placeholder={dictionary.otherPlaceholder}
            />
          </label>
          {showHint && (!platform || !satisfaction) ? (
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
