import { CONTENT_LOCALES } from "@astrodx/content-schema";

import type { LinkEntryDraft, LocalizedDraft } from "../lib/content-draft";

const LOCALE_LABELS: Record<string, string> = { zh: "中文", en: "English", ja: "日本語" };

type Props = {
  entry: LinkEntryDraft;
  /** 这个条目在 JSON 里的路径前缀，例如 `links[0]`。错误消息按它匹配。 */
  path: string;
  errors: Map<string, string[]>;
  onChange: (next: LinkEntryDraft) => void;
};

function FieldErrors({ path, errors }: { path: string; errors: Map<string, string[]> }) {
  const messages = errors.get(path);
  if (!messages) return null;
  return (
    <p className="dash-field-error" role="alert">
      {messages.join("；")}
    </p>
  );
}

/**
 * 一个 links 数组条目（名称 + 链接 + 可选说明）的三语表单字段。
 *
 * 只管渲染和把编辑结果通过 onChange 报给调用方——不持有任何状态，条目的
 * 增删排序、以及把整个数组写回草稿，都是调用方（content.$key.tsx）的事。
 */
export function LinkEntryFields({ entry, path, errors, onChange }: Props) {
  const setLocalized = (field: "name" | "description", locale: string, value: string) => {
    const current = (entry[field] ?? {}) as LocalizedDraft;
    onChange({ ...entry, [field]: { ...current, [locale]: value } });
  };

  return (
    <div className="dash-entry">
      <fieldset className="dash-entry-locales">
        <legend>名称</legend>
        {CONTENT_LOCALES.map((locale) => (
          <label key={locale}>
            <span>{LOCALE_LABELS[locale]}</span>
            <input
              value={entry.name[locale] ?? ""}
              onChange={(event) => setLocalized("name", locale, event.target.value)}
            />
            <FieldErrors path={`${path}.name.${locale}`} errors={errors} />
          </label>
        ))}
      </fieldset>

      <label className="dash-entry-url">
        <span>链接</span>
        <input
          type="url"
          inputMode="url"
          value={entry.url}
          onChange={(event) => onChange({ ...entry, url: event.target.value })}
        />
        <FieldErrors path={`${path}.url`} errors={errors} />
      </label>

      {entry.description ? (
        <fieldset className="dash-entry-locales">
          <legend>说明</legend>
          {CONTENT_LOCALES.map((locale) => (
            <label key={locale}>
              <span>{LOCALE_LABELS[locale]}</span>
              <textarea
                rows={3}
                value={entry.description?.[locale] ?? ""}
                onChange={(event) => setLocalized("description", locale, event.target.value)}
              />
              <FieldErrors path={`${path}.description.${locale}`} errors={errors} />
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
