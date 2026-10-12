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
      description: "右下角的 Live2D 看板娘。仅在宽屏且未开启简化兼容模式时出现。",
      enable: "显示",
      disable: "隐藏",
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
        "The Live2D mascot in the bottom-right corner. She only appears on wide screens with simple compatibility mode off.",
      enable: "Show",
      disable: "Hide",
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
        "右下に表示される Live2D の看板娘です。ワイド画面で、簡易互換モードがオフのときだけ表示されます。",
      enable: "表示",
      disable: "非表示",
    },
  },
};

export function getLive2DCopy(locale: Locale): Live2DCopy {
  return copies[locale];
}
