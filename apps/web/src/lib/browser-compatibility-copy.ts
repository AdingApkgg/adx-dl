import type { Locale } from "./i18n";

const copy = {
  zh: {
    title: "浏览器兼容性", mode: "简化兼容模式", normal: "标准界面", simple: "简化界面",
    description: "减少动画、模糊和透明叠层，保留选曲、预览和下载。开启后暂时减少动画，关闭后恢复原动画偏好。",
    diagnostics: "检查浏览器兼容性", checking: "正在检查…", diagnosticHelp: "检查下载缓存和保存接口。结果仅在本机生成，不会自动上传；接口可用不代表文件已经保存。",
    report: "浏览器诊断信息", copy: "复制诊断信息", copied: "已复制", manualCopy: "无法自动复制，请在下方选中文本手动复制。",
    fallback: "下载缓存不可用，请保持页面打开，分批保存文件；关闭或刷新后可能需要重新下载。",
    saveUnsupported: "浏览器未提供所需的文件保存接口，请允许本站下载，或换用支持文件下载的浏览器。",
    noScript: "浏览器未启用 JavaScript，筛选、谱面预览和站内打包无法使用。请允许本站运行 JavaScript；现有页面内容和教程仍可阅读。",
    guide: "查看导入与排障教程", errorDiagnostics: "浏览器诊断与兼容帮助",
  },
  en: {
    title: "Browser compatibility", mode: "Simple compatibility mode", normal: "Standard interface", simple: "Simple interface",
    description: "Reduce motion, blur and translucent layers while keeping chart selection, preview and downloads. Your motion preference is restored when this mode is off.",
    diagnostics: "Check browser compatibility", checking: "Checking…", diagnosticHelp: "Check download storage and save APIs. Results stay on this device and are never uploaded automatically. Available APIs do not confirm that a file was saved.",
    report: "Browser diagnostic information", copy: "Copy diagnostics", copied: "Copied", manualCopy: "Automatic copy failed. Select and copy the text below.",
    fallback: "Download storage is unavailable. Keep this page open and save each batch; closing or reloading may require downloading again.",
    saveUnsupported: "Required file-saving APIs are unavailable. Allow downloads for this site or use a browser that supports file downloads.",
    noScript: "JavaScript is disabled. Filters, chart preview and onsite packing cannot run. Allow JavaScript for this site; existing page content and guides remain readable.",
    guide: "Read the import and troubleshooting guide", errorDiagnostics: "Browser diagnostics and compatibility help",
  },
  ja: {
    title: "ブラウザの互換性", mode: "簡易互換モード", normal: "標準表示", simple: "簡易表示",
    description: "選曲・プレビュー・ダウンロードを維持し、アニメーションやぼかし、半透明の表示を減らします。無効にすると元のアニメーション設定に戻ります。",
    diagnostics: "ブラウザの互換性を確認", checking: "確認中…", diagnosticHelp: "ダウンロードの保存領域と保存 API を確認します。結果は端末内で生成され、自動送信されません。API が使えてもファイルの保存完了を意味しません。",
    report: "ブラウザ診断情報", copy: "診断情報をコピー", copied: "コピーしました", manualCopy: "自動コピーできませんでした。下のテキストを選択してコピーしてください。",
    fallback: "ダウンロード用の保存領域が使えません。ページを開いたまま各バッチを保存してください。閉じるか再読み込みすると再ダウンロードが必要になる場合があります。",
    saveUnsupported: "ファイル保存に必要な API が使えません。このサイトのダウンロードを許可するか、対応ブラウザを使用してください。",
    noScript: "JavaScript が無効です。絞り込み・譜面プレビュー・サイト内のパッケージ作成は使えません。このサイトの JavaScript を許可してください。ページの内容とガイドは引き続き読めます。",
    guide: "インポートとトラブル解決のガイド", errorDiagnostics: "ブラウザ診断と互換性のヘルプ",
  },
} satisfies Record<Locale, Record<string, string>>;

export function getBrowserCompatibilityCopy(locale: Locale) {
  return copy[locale];
}
