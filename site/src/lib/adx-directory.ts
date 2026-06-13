export type AdxRemoteFile = {
  name: string;
  url: string;
};

const ADX_SOURCE_ROOT = "https://adx-dl.larx.cc/";

export function buildAdxDirectoryUrl(directoryName: string): string {
  const trimmed = directoryName.trim();

  if (!trimmed) {
    throw new Error("Directory name is required");
  }

  return new URL(`${encodeURIComponent(trimmed)}/`, ADX_SOURCE_ROOT).toString();
}

export function parseAdxDirectoryFiles(html: string, directoryUrl: string): AdxRemoteFile[] {
  const directory = new URL(directoryUrl);
  const names = new Set<string>();

  const files = [...html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, , href, rawText]) => {
      const text = rawText.replace(/<[^>]+>/g, "").trim();

      if (!href || href.startsWith("?") || /parent directory/i.test(text)) {
        return null;
      }

      const url = new URL(href, directory);
      const relativePath = url.pathname.slice(directory.pathname.length);

      if (!relativePath || relativePath.includes("/") || href.endsWith("/")) {
        return null;
      }

      const name = decodeURIComponent(relativePath);
      if (names.has(name)) {
        throw new Error(`Duplicate file name: ${name}`);
      }

      names.add(name);
      return { name, url: url.toString() };
    })
    .filter((file): file is AdxRemoteFile => file !== null);

  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  return files;
}

export async function fetchAdxDirectoryFiles(directoryName: string): Promise<AdxRemoteFile[]> {
  const directoryUrl = buildAdxDirectoryUrl(directoryName);
  const response = await fetch(directoryUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Directory does not exist or is not accessible");
  }

  return parseAdxDirectoryFiles(await response.text(), directoryUrl);
}
