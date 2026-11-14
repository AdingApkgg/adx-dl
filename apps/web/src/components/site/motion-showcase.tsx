"use client";

import { useState } from "react";

import { Button } from "@astrodx/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@astrodx/ui/components/dropdown-menu";
import { MotionPicker } from "@astrodx/ui/components/appearance-pickers";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@astrodx/ui/components/sheet";
import { Skeleton } from "@astrodx/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@astrodx/ui/components/tabs";
import { DrawnCheck, Reveal, RevealGroup, RevealItem, RollingNumber, useReducedMotion } from "@astrodx/ui/motion";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: { title: "动效", note: "体验按压、选中、弹层和内容入场；可切换减少动态效果。", press: "按压反馈", link: "链接按压", menu: "打开菜单", item: "菜单选项", side: "侧边面板", centered: "居中弹窗", fullscreen: "全屏面板", close: "关闭", body: "可使用 Esc 关闭，焦点会回到打开按钮。", replay: "再次展示", number: "更新数字", success: "完成", mode: { system: "跟随系统", on: "始终开启动画", off: "减少动态效果" }, reduced: "当前：减少动态效果", full: "当前：完整动效" },
  en: { title: "Motion", note: "Try press, selection, surfaces and reveals, including reduced motion.", press: "Press feedback", link: "Link press", menu: "Open menu", item: "Menu item", side: "Side panel", centered: "Centered dialog", fullscreen: "Fullscreen panel", close: "Close", body: "Press Escape to close and return focus to the trigger.", replay: "Replay", number: "Update number", success: "Complete", mode: { system: "Follow system", on: "Always animate", off: "Reduce motion" }, reduced: "Reduced motion active", full: "Full motion active" },
  ja: { title: "モーション", note: "押下、選択、パネル、表示アニメーションと動きの軽減を確認できます。", press: "押下の反応", link: "リンクの反応", menu: "メニューを開く", item: "メニュー項目", side: "サイドパネル", centered: "中央ダイアログ", fullscreen: "全画面パネル", close: "閉じる", body: "Esc で閉じると、開いたボタンにフォーカスが戻ります。", replay: "もう一度表示", number: "数値を更新", success: "完了", mode: { system: "システムに従う", on: "常にアニメーション", off: "動きを軽減" }, reduced: "動きを軽減中", full: "通常のモーション" },
};

/** Real shared components for visual calibration; mounted only on the /ui page. */
export function MotionShowcase({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const [iteration, setIteration] = useState(0);
  const [value, setValue] = useState(128);
  const reduced = useReducedMotion();
  return (
    <section id="motion" className="flex flex-col gap-4" aria-labelledby="motion-title">
      <h2 id="motion-title" className="text-xl font-semibold">{c.title}</h2>
      <Reveal ssrVisible data-motion-readable><p className="text-sm text-muted-foreground">{c.note}</p></Reveal>
      <MotionPicker labels={{ modes: c.mode, hints: c.mode }} />
      <p role="status" className="text-sm text-muted-foreground">{reduced ? c.reduced : c.full}</p>
      <div className="flex flex-wrap gap-2">
        <Button>{c.press}</Button>
        <Button asChild variant="outline"><a href="#motion">{c.link}</a></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">{c.menu}</Button></DropdownMenuTrigger><DropdownMenuContent>{[1, 2, 3].map((n) => <DropdownMenuItem key={n}>{c.item} {n}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
        {(["side", "centered", "fullscreen"] as const).map((variant) => (
          <Sheet key={variant}>
            <SheetTrigger asChild><Button variant="outline">{c[variant]}</Button></SheetTrigger>
            <SheetContent variant={variant} closeLabel={c.close} className="p-6">
              <SheetTitle>{c[variant]}</SheetTitle><SheetDescription>{c.body}</SheetDescription>
              <Button className="mt-6 w-fit">{c.press}</Button>
              <Skeleton className="mt-4 h-8 w-40" />
            </SheetContent>
          </Sheet>
        ))}
      </div>
      <div className="flex flex-wrap gap-6">
        {(["default", "line"] as const).map((variant) => (
          <Tabs key={variant} defaultValue="one">
            <TabsList variant={variant}>{["one", "two", "three"].map((tab, index) => <TabsTrigger key={tab} value={tab}>{index + 1}</TabsTrigger>)}</TabsList>
            {["one", "two", "three"].map((tab, index) => <TabsContent key={tab} value={tab}>{c.title} {index + 1}</TabsContent>)}
          </Tabs>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => setValue((v) => v + 127)}>{c.number}</Button>
        <span className="text-xl tabular-nums"><RollingNumber value={value} /></span>
        <Button variant="secondary" onClick={() => setIteration((v) => v + 1)}>{c.replay}</Button>
      </div>
      <RevealGroup key={iteration} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <RevealItem key={i} ssrVisible={false} className="flex items-center gap-2 rounded-lg border p-3"><DrawnCheck withCircle={false} /><span>{c.success} {i + 1}</span></RevealItem>)}
      </RevealGroup>
      <Skeleton className="h-8 w-48" />
    </section>
  );
}
