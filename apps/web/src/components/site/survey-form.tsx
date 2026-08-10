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

type FieldName = "platform" | "satisfaction";

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
  const [errors, setErrors] = React.useState<FieldName[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const platformRef = React.useRef<HTMLButtonElement>(null);
  const satisfactionRef = React.useRef<HTMLButtonElement>(null);

  const invalid = (field: FieldName): boolean => errors.includes(field);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const missing: FieldName[] = [];
      if (!platform) missing.push("platform");
      if (!satisfaction) missing.push("satisfaction");
      setErrors(missing);
      if (missing.length > 0) {
        // Focus the offending control rather than leaving a lone generic
        // message at the bottom of a noValidate form.
        const first = missing[0] === "platform" ? platformRef : satisfactionRef;
        first.current?.focus();
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
      // The guestbook is a separate route; without a pending state a slow
      // navigation reads as a dead click.
      setSubmitting(true);
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
                ref={platformRef}
                className="w-full"
                aria-labelledby="survey-platform-label"
                aria-required="true"
                aria-invalid={invalid("platform") ? true : undefined}
                aria-describedby={
                  invalid("platform") ? "survey-platform-error" : undefined
                }
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
            {invalid("platform") ? (
              <span id="survey-platform-error" className="text-sm font-normal text-destructive">
                {dictionary.platformRequired}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            <span id="survey-satisfaction-label">{dictionary.satisfactionLabel}</span>
            <Select value={satisfaction} onValueChange={setSatisfaction}>
              <SelectTrigger
                ref={satisfactionRef}
                className="w-full"
                aria-labelledby="survey-satisfaction-label"
                aria-required="true"
                aria-invalid={invalid("satisfaction") ? true : undefined}
                aria-describedby={
                  invalid("satisfaction") ? "survey-satisfaction-error" : undefined
                }
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
            {invalid("satisfaction") ? (
              <span
                id="survey-satisfaction-error"
                className="text-sm font-normal text-destructive"
              >
                {dictionary.satisfactionRequired}
              </span>
            ) : null}
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
          {/* Always mounted so it is announced when it fills; the per-field
              messages above carry the specifics. */}
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
