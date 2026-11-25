export async function enabled(input) { await input.waitFor(); await input.evaluate(el => new Promise((resolve, reject) => { const deadline = Date.now() + 30000; const check = () => { if (!el.matches(":disabled")) resolve(); else if (Date.now() > deadline) reject(Error("IMPORT_INITIALIZATION_TIMEOUT")); else setTimeout(check, 20); }; check(); })); }
export async function chooseFiles(input, files) { await enabled(input); await input.setInputFiles(files); }

export async function openChartPublicationReview(page) {
  const publication = page.getByRole("region", { name: "公开发布", exact: true });
  await publication.getByRole("button", { name: /^检查并(?:发布|更新)$/ }).click();
  return publication;
}
