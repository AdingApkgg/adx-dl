import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { m } from "@/paraglide/messages.js";

import { ProfileFields } from "./profile-fields";

function render(name: string, bio: string): string {
  return renderToStaticMarkup(<ProfileFields name={name} bio={bio} onNameChange={() => {}} onBioChange={() => {}} />);
}

describe("ProfileFields", () => {
  test("昵称和简介带着当前的值；昵称最多 24 个字符", () => {
    const html = render("阿丁", "第一行\n第二行");

    expect(html).toContain('value="阿丁"');
    expect(html).toContain('maxLength="24"');
    expect(html).toContain("第一行\n第二行</textarea>");
    expect(html).toContain(m.profile_nickname_hint());
  });

  // 按码点数，和服务端的规则一样：表情算一个；首尾空白不算。
  test("简介的字数按规整后的码点数显示", () => {
    expect(render("阿丁", "  😀😀a  ")).toContain(m.profile_bio_count({ count: 3, max: 300 }));
  });
});
