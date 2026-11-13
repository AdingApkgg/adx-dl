/* Development-only same-origin preview. No app imports, new routes or dependencies. */
const variants = new Set(["fluent", "expressive", "material2", "material2-sharp"]);
const paths = { search: "/charts", detail: "/charts/12061", downloads: "/charts/12061" };
const params = new URLSearchParams(location.search);
let variant = variants.has(params.get("style")) ? params.get("style") : "fluent";
let page = Object.hasOwn(paths, params.get("page")) ? params.get("page") : "detail";
const frame = document.getElementById("preview");
const stylePicker = document.getElementById("style");
const pagePicker = document.getElementById("page");
const state = document.getElementById("state");
const common = fetch("common.css").then((response) => response.text());
const sheets = new Map();
let applyVersion = 0;

async function apply() {
  const version = ++applyVersion;
  if (!sheets.has(variant)) sheets.set(variant, fetch(`${variant.startsWith("material2") ? "material2" : variant}.css`).then((response) => response.text()));
  const css = `${await common}\n${await sheets.get(variant)}`;
  if (version !== applyVersion) return;
  const doc = frame.contentDocument;
  if (!doc?.head) return;
  let style = doc.getElementById("design-concept-styles");
  if (!style) {
    style = doc.createElement("style");
    style.id = "design-concept-styles";
    doc.head.append(style);
  }
  doc.documentElement.classList.remove("dark");
  doc.documentElement.style.colorScheme = "light";
  doc.documentElement.dataset.designConcept = variant;
  if (style.textContent !== css) style.textContent = css;
  state.textContent = page === "downloads" ? "开发预览 · 下载后可展开管理器" : "仅开发预览 · 未发布";
  document.body.dataset.ready = variant;
}
function updateUrl() {
  history.replaceState(null, "", `?style=${variant}&page=${page}`);
}
stylePicker.value = variant;
pagePicker.value = page;
stylePicker.addEventListener("change", () => { variant = stylePicker.value; updateUrl(); void apply(); });
pagePicker.addEventListener("change", () => { page = pagePicker.value; delete document.body.dataset.ready; updateUrl(); frame.src = paths[page]; });
frame.addEventListener("load", () => { void apply(); });
frame.src = paths[page];
// Soft route transitions can replace head metadata. Restore only if our sheet disappeared.
setInterval(() => { if (frame.contentDocument?.head && !frame.contentDocument.getElementById("design-concept-styles")) void apply(); }, 750);
