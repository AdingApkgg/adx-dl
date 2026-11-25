import { m } from "@/paraglide/messages.js";
import type { ChartArchiveFormat } from "../downloads/chart-export";

export function DownloadFormat({ value, disabled, onChange }: {
  value: ChartArchiveFormat;
  disabled?: boolean;
  onChange: (value: ChartArchiveFormat) => void;
}) {
  return <label className="inline-flex flex-wrap items-center gap-2 text-sm">
    {m.ui_download_format()}
    <select
      className="min-h-11 rounded-md border px-2"
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.currentTarget.value === "adx" ? "adx" : "zip")}
    >
      <option value="adx">{m.ui_download_format_adx()}</option>
      <option value="zip">{m.ui_download_format_zip()}</option>
    </select>
  </label>;
}
