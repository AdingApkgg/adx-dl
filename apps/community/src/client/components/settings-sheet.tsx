import { AccentPicker, MotionPicker, ThemePicker } from "@astrodx/ui/components/appearance-pickers";
import { Button } from "@astrodx/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@astrodx/ui/components/sheet";
import { Settings2Icon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { m } from "@/paraglide/messages.js";

// 页头的设置按钮：点开侧边面板，里面是明暗模式、强调色、减少动画三项（spec 第 7.2 节）。设置只存在这个浏览器里。
export function SettingsSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={m.appearance_open()} title={m.appearance_open()}>
          <Settings2Icon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent closeLabel={m.appearance_close()} className="max-w-md gap-6 overflow-y-auto p-6">
        <SheetHeader className="pr-8">
          <SheetTitle>{m.appearance_title()}</SheetTitle>
          <SheetDescription>{m.appearance_description()}</SheetDescription>
        </SheetHeader>
        <SettingsGroup label={m.appearance_theme()}>
          <ThemePicker
            labels={{
              system: m.appearance_theme_system(),
              light: m.appearance_theme_light(),
              dark: m.appearance_theme_dark(),
            }}
          />
        </SettingsGroup>
        <SettingsGroup label={m.appearance_accent()}>
          <AccentPicker
            labels={{
              blue: m.appearance_accent_blue(),
              violet: m.appearance_accent_violet(),
              teal: m.appearance_accent_teal(),
              orange: m.appearance_accent_orange(),
              rose: m.appearance_accent_rose(),
            }}
          />
        </SettingsGroup>
        <SettingsGroup label={m.appearance_motion()}>
          <MotionPicker
            labels={{
              modes: {
                system: m.appearance_motion_system(),
                on: m.appearance_motion_on(),
                off: m.appearance_motion_off(),
              },
              hints: {
                system: m.appearance_motion_system_hint(),
                on: m.appearance_motion_on_hint(),
                off: m.appearance_motion_off_hint(),
              },
            }}
          />
        </SettingsGroup>
      </SheetContent>
    </Sheet>
  );
}

// 一组按钮加上它的小标题；读屏软件把小标题读成这组按钮的名字。
function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-sm font-medium">
        {label}
      </h3>
      {children}
    </div>
  );
}
