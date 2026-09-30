import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";

import { m } from "@/paraglide/messages.js";
import { NICKNAME_MAX, parseNickname } from "@/shared/nickname";

import { ProfileFields } from "./profile-fields";

function render(name: string, bio: string): string {
  return renderToStaticMarkup(<ProfileFields name={name} bio={bio} onNameChange={() => {}} onBioChange={() => {}} />);
}

// 页面里 <input> 或 <textarea> 的开始标签。
function openingTag(html: string, tag: "input" | "textarea"): string {
  const match = new RegExp(`<${tag}\\b[^>]*>`).exec(html);
  if (!match) {
    throw new Error(`没有渲染出 <${tag}>`);
  }
  return match[0];
}

describe("ProfileFields", () => {
  test("昵称和简介带着当前的值；两个输入框都没有 maxlength", () => {
    const html = render("阿丁", "第一行\n第二行");

    expect(html).toContain('value="阿丁"');
    expect(html).toContain("第一行\n第二行</textarea>");
    expect(html).toContain(m.profile_nickname_hint());
    // 浏览器的 maxlength 按 UTF-16 码元数，规则按码点数：表情算两个，会挡住合法的昵称。长度留给提交时的检查。
    // React 输出的属性名是 maxLength，HTML 不分大小写，所以不区分大小写地找。
    expect(openingTag(html, "input")).not.toMatch(/maxlength/i);
    expect(openingTag(html, "textarea")).not.toMatch(/maxlength/i);
  });

  // 24 个表情是合法的昵称（24 个码点），却有 48 个码元。静态标记不会按 maxlength 截断预填的值，所以除了值完整，
  // 还要没有 maxlength：有的话，用户一编辑，浏览器就把它判为超长（tooLong）并挡住提交。
  test("24 个表情的昵称是合法的，原样放在输入框里", () => {
    const name = "😀".repeat(NICKNAME_MAX);
    const input = openingTag(render(name, ""), "input");

    expect(parseNickname(name)).toBe(name);
    expect(input).toContain(`value="${name}"`);
    expect(input).not.toMatch(/maxlength/i);
  });

  // 按码点数，和服务端的规则一样：表情算一个；首尾空白不算。
  test("简介的字数按规整后的码点数显示", () => {
    expect(render("阿丁", "  😀😀a  ")).toContain(m.profile_bio_count({ count: 3, max: 300 }));
  });
});
