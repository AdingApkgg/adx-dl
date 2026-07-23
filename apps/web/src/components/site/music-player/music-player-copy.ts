import type { Locale } from "@/lib/i18n";

export type MusicPlayerCopy = {
  playerLabel: string;
  panelTitle: string;
  panelDescription: string;
  openPlaylist: string;
  play: string;
  pause: string;
  previous: string;
  next: string;
  versionLabel: string;
  volume: string;
  mute: string;
  unmute: string;
  seek: string;
  loading: string;
  loadError: string;
  retry: string;
  noTracks: string;
  unknownArtist: string;
  pausedByOtherMedia: string;
  trackCount: (count: number) => string;
  mode: {
    sequence: string;
    shuffle: string;
    "repeat-one": string;
  };
  modeHint: {
    sequence: string;
    shuffle: string;
    "repeat-one": string;
  };
};

const copies: Record<Locale, MusicPlayerCopy> = {
  zh: {
    playerLabel: "音乐播放器",
    panelTitle: "版本歌单",
    panelDescription: "选择一个 maimai 版本并连续播放其中的曲目。",
    openPlaylist: "打开版本歌单",
    play: "播放",
    pause: "暂停",
    previous: "上一首",
    next: "下一首",
    versionLabel: "选择版本",
    volume: "音量",
    mute: "静音",
    unmute: "取消静音",
    seek: "播放进度",
    loading: "正在载入歌单…",
    loadError: "歌单载入失败",
    retry: "重试",
    noTracks: "这个版本暂时没有可播放的曲目。",
    unknownArtist: "未知艺术家",
    pausedByOtherMedia: "已为谱面试听暂停",
    trackCount: (count) => `${count} 首`,
    mode: {
      sequence: "顺序播放",
      shuffle: "随机播放",
      "repeat-one": "单曲循环",
    },
    modeHint: {
      sequence: "当前为顺序播放，点击切换为随机播放",
      shuffle: "当前为随机播放，点击切换为单曲循环",
      "repeat-one": "当前为单曲循环，点击切换为顺序播放",
    },
  },
  en: {
    playerLabel: "Music player",
    panelTitle: "Version playlists",
    panelDescription: "Choose a maimai version and play its tracks continuously.",
    openPlaylist: "Open version playlists",
    play: "Play",
    pause: "Pause",
    previous: "Previous track",
    next: "Next track",
    versionLabel: "Choose version",
    volume: "Volume",
    mute: "Mute",
    unmute: "Unmute",
    seek: "Playback position",
    loading: "Loading playlist…",
    loadError: "Could not load the playlist",
    retry: "Retry",
    noTracks: "This version has no playable tracks yet.",
    unknownArtist: "Unknown artist",
    pausedByOtherMedia: "Paused for chart preview",
    trackCount: (count) => `${count} tracks`,
    mode: {
      sequence: "Play in order",
      shuffle: "Shuffle",
      "repeat-one": "Repeat one",
    },
    modeHint: {
      sequence: "Playing in order. Switch to shuffle.",
      shuffle: "Shuffling. Switch to repeat one.",
      "repeat-one": "Repeating one track. Switch to play in order.",
    },
  },
  ja: {
    playerLabel: "音楽プレイヤー",
    panelTitle: "バージョン別プレイリスト",
    panelDescription: "maimai のバージョンを選び、収録曲を続けて再生します。",
    openPlaylist: "バージョン別プレイリストを開く",
    play: "再生",
    pause: "一時停止",
    previous: "前の曲",
    next: "次の曲",
    versionLabel: "バージョンを選択",
    volume: "音量",
    mute: "ミュート",
    unmute: "ミュート解除",
    seek: "再生位置",
    loading: "プレイリストを読み込み中…",
    loadError: "プレイリストを読み込めませんでした",
    retry: "再試行",
    noTracks: "このバージョンには再生できる曲がありません。",
    unknownArtist: "アーティスト不明",
    pausedByOtherMedia: "譜面プレビューのため一時停止しました",
    trackCount: (count) => `${count} 曲`,
    mode: {
      sequence: "順番に再生",
      shuffle: "シャッフル",
      "repeat-one": "1 曲リピート",
    },
    modeHint: {
      sequence: "順番に再生中。シャッフルへ切り替えます。",
      shuffle: "シャッフル中。1 曲リピートへ切り替えます。",
      "repeat-one": "1 曲リピート中。順番に再生へ切り替えます。",
    },
  },
};

export function getMusicPlayerCopy(locale: Locale): MusicPlayerCopy {
  return copies[locale];
}
