import type { Locale } from "@/lib/i18n";

// The mascot's speech (public/live2d/waifu-tips.json and hitokoto) is part of
// the character and stays Chinese; only the controls around her are localized.
export type Live2DCopy = {
  toolbar: string;
  tools: {
    hitokoto: string;
    asteroids: string;
    switchModel: string;
    switchTexture: string;
    photo: string;
    info: string;
    quit: string;
  };
  settings: {
    title: string;
    description: string;
    enable: string;
    disable: string;
    /** Link to the mascot page, for everyone the corner leaves out. */
    openPage: string;
  };
  page: {
    /** "More" menu entry. */
    navLabel: string;
    title: string;
    description: string;
    loading: string;
    failed: string;
    tapHint: string;
    actionsTitle: string;
    cornerTitle: string;
    credits: string;
  };
};

const copies: Record<Locale, Live2DCopy> = {
  zh: {
    toolbar: "看板娘工具栏",
    tools: {
      hitokoto: "一言",
      asteroids: "打飞机",
      switchModel: "换人",
      switchTexture: "换装",
      photo: "拍照",
      info: "关于",
      quit: "再见（可在设置中重新打开）",
    },
    settings: {
      title: "看板娘",
      description: "右下角的 Live2D 看板娘。仅在宽屏、使用鼠标且未开启简化兼容模式时出现。",
      enable: "显示",
      disable: "隐藏",
      openPage: "打开看板娘页面（手机和触屏也能用）",
    },
    page: {
      navLabel: "看板娘",
      title: "看板娘",
      description:
        "和站里的 Live2D 看板娘玩一会儿吧：换衣服、换人、听她念一句一言，或者给她拍张照。手机和触屏设备也能在这里见到她。",
      loading: "看板娘正在赶来…",
      failed: "看板娘没能出现。可能是连不上模型所在的 CDN（npmmirror），或者浏览器不支持 WebGL。",
      tapHint: "点她一下，她会做动作。",
      actionsTitle: "互动",
      cornerTitle: "在其他页面的右下角",
      credits: "模型来自 AdingApkgg/live2d-api（weblive2d），由 Live2D Cubism 2 Core 渲染（© Live2D Inc.）。",
    },
  },
  en: {
    toolbar: "Mascot tools",
    tools: {
      hitokoto: "Random quote",
      asteroids: "Play Asteroids",
      switchModel: "Switch character",
      switchTexture: "Change outfit",
      photo: "Take a photo",
      info: "About",
      quit: "Goodbye (turn her back on in Settings)",
    },
    settings: {
      title: "Live2D mascot",
      description:
        "The Live2D mascot in the bottom-right corner. She only appears on wide screens with a mouse, with simple compatibility mode off.",
      enable: "Show",
      disable: "Hide",
      openPage: "Open the mascot page (works on phones and touch screens too)",
    },
    page: {
      navLabel: "Live2D mascot",
      title: "Live2D Mascot",
      description:
        "Spend a moment with the site's Live2D mascot: change her outfit, switch characters, hear a random quote, or take her photo. Phones and touch screens can meet her here too.",
      loading: "She's on her way…",
      failed:
        "The mascot couldn't appear. The model CDN (npmmirror) may be unreachable, or this browser lacks WebGL.",
      tapHint: "Tap her and she'll move. Her lines are in Chinese.",
      actionsTitle: "Play",
      cornerTitle: "In the corner of other pages",
      credits:
        "Models from AdingApkgg/live2d-api (weblive2d), rendered with the Live2D Cubism 2 Core (© Live2D Inc.).",
    },
  },
  ja: {
    toolbar: "看板娘ツール",
    tools: {
      hitokoto: "ひとこと",
      asteroids: "シューティング",
      switchModel: "キャラ切替",
      switchTexture: "着替え",
      photo: "撮影",
      info: "について",
      quit: "さようなら（設定から再表示できます）",
    },
    settings: {
      title: "看板娘",
      description:
        "右下に表示される Live2D の看板娘です。ワイド画面でマウスを使い、簡易互換モードがオフのときだけ表示されます。",
      enable: "表示",
      disable: "非表示",
      openPage: "看板娘ページを開く（スマホ・タッチ端末でも使えます）",
    },
    page: {
      navLabel: "看板娘",
      title: "看板娘",
      description:
        "サイトの Live2D 看板娘とひと休み。着替え、キャラ切替、ひとこと、撮影ができます。スマホやタッチ端末でもここで会えます。",
      loading: "看板娘が向かっています…",
      failed:
        "看板娘を表示できませんでした。モデルの CDN（npmmirror）に接続できないか、ブラウザが WebGL に対応していない可能性があります。",
      tapHint: "タップすると動きます。セリフは中国語です。",
      actionsTitle: "あそぶ",
      cornerTitle: "ほかのページの右下",
      credits:
        "モデルは AdingApkgg/live2d-api（weblive2d）、描画は Live2D Cubism 2 Core（© Live2D Inc.）です。",
    },
  },
};

export function getLive2DCopy(locale: Locale): Live2DCopy {
  return copies[locale];
}
