import { describe, expect, test } from "bun:test";

import { validateLinkListFile } from "@astrodx/content-schema";

import {
  contentFormKey,
  emptyEntry,
  errorsByPath,
  moveEntry,
  removeEntry,
  replaceEntry,
  setLocalizedField,
} from "./content-draft";

describe("moveEntry", () => {
  test("移动一个条目，返回一个新数组", () => {
    const list = ["a", "b", "c"];
    expect(moveEntry(list, 2, -1)).toEqual(["a", "c", "b"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  test("移到任一端之外是空操作，不会绕回另一端", () => {
    // 一个「上移」按钮在第一条上被点到时必须什么都不做——绕回末尾是
    // 每个人都会点错一次的那种行为。
    expect(moveEntry(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveEntry(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  test("越界的下标是空操作", () => {
    expect(moveEntry(["a"], 5, -1)).toEqual(["a"]);
  });
});

describe("removeEntry / replaceEntry", () => {
  test("removeEntry 删掉一个，其余复制过去", () => {
    const list = ["a", "b", "c"];
    expect(removeEntry(list, 1)).toEqual(["a", "c"]);
    expect(list).toHaveLength(3);
  });

  test("replaceEntry 只替换一个，不动相邻条目", () => {
    expect(replaceEntry(["a", "b"], 0, "z")).toEqual(["z", "b"]);
  });
});

describe("setLocalizedField", () => {
  test("只改指定的那一种语言，另外两种原样保留", () => {
    const entry = { name: { zh: "中", en: "EN", ja: "日" }, url: "https://example.com/" };
    expect(setLocalizedField(entry, "name", "en", "New").name).toEqual({ zh: "中", en: "New", ja: "日" });
  });

  test("不改入参", () => {
    const entry = { name: { zh: "中", en: "EN", ja: "日" }, url: "https://example.com/" };
    setLocalizedField(entry, "name", "en", "New");
    expect(entry.name.en).toBe("EN");
  });

  test("条目上的其它字段原样保留", () => {
    const entry = {
      name: { zh: "中", en: "EN", ja: "日" },
      url: "https://example.com/",
      description: { zh: "说明", en: "Desc", ja: "説明" },
    };
    const next = setLocalizedField(entry, "name", "zh", "新");
    expect(next.url).toBe("https://example.com/");
    expect(next.description).toEqual(entry.description);
  });

  test("字段原本不存在时也能建起来（description 可选）", () => {
    const entry = { name: { zh: "中", en: "EN", ja: "日" }, url: "https://example.com/" };
    expect(setLocalizedField(entry, "description", "zh", "说明").description).toEqual({ zh: "说明" });
  });
});

describe("emptyEntry", () => {
  test("三个语言都带齐，表单才能渲染出每一个输入框", () => {
    expect(emptyEntry(true)).toEqual({
      name: { zh: "", en: "", ja: "" },
      url: "",
      description: { zh: "", en: "", ja: "" },
    });
  });

  test("数组不需要 description 时就不建这个字段", () => {
    expect(emptyEntry(false)).toEqual({ name: { zh: "", en: "", ja: "" }, url: "" });
  });

  test("刚建好的空条目校验不通过——必须先填内容", () => {
    expect(validateLinkListFile({ x: [emptyEntry(true)] }, [{ key: "x", requireDescription: true }]).ok).toBe(false);
  });
});

describe("errorsByPath", () => {
  test("按冒号前的路径前缀给消息建索引", () => {
    const index = errorsByPath(["links[0].name.ja: 必须是非空字符串", "links[0].url: 不是合法的 URL"]);
    expect(index.get("links[0].name.ja")).toEqual(["必须是非空字符串"]);
    expect(index.get("links[0].url")).toEqual(["不是合法的 URL"]);
  });

  test("同一个路径下可以挂多条消息", () => {
    const index = errorsByPath(["a: one", "a: two"]);
    expect(index.get("a")).toEqual(["one", "two"]);
  });

  test("没有冒号的消息归到空路径下，而不是被丢弃", () => {
    // 「顶层必须是对象」这类没有路径的错误也得有地方显示。
    expect(errorsByPath(["顶层必须是对象"]).get("")).toEqual(["顶层必须是对象"]);
  });

  test("只按第一个冒号切——说明里自带的冒号原样保留", () => {
    expect(errorsByPath(["a.url: 只允许 http/https，拿到的是 javascript:"]).get("a.url")).toEqual([
      "只允许 http/https，拿到的是 javascript:",
    ]);
  });

  test("切点是第一个「: 」，不是最后一个——消息里出现两次「: 」才分辨得出来", () => {
    // 上面那条「javascript:」用例的冒号在末尾且后面没空格，根本不会被当成
    // 切点；这个仓库里所有既有用例的 ": " 都只出现一次，indexOf 和 lastIndexOf
    // 切出来的结果永远一样，分辨不出实现到底用了哪个。这条消息里 ": " 出现两次：
    // 如果实现换成 lastIndexOf，会把 "a.b: 前一步失败" 整个当成路径，
    // 只剩 "原始错误" 当消息，下面的断言就会失败。
    const index = errorsByPath(["a.b: 前一步失败: 原始错误"]);
    expect(index.get("a.b")).toEqual(["前一步失败: 原始错误"]);
  });

  test("钉住前向约束：服务端带文件标题前缀的 errors[] 不能喂进来——喂了的话，切出来的路径不是合法字段路径，错误提示会静默消失", () => {
    // 真实的服务端错误长这样：routes/content.ts 用 `${spec.title}：${error}`
    // 拼出来的（标题和路径之间是全角冒号），title 取自 content-schema 的
    // registry.ts——community 那一条是「社区与联系方式」。
    const realFieldPath = "contactChannels[0].name.ja";
    const serverError = `社区与联系方式：${realFieldPath}: 必须是非空字符串`;

    const index = errorsByPath([serverError]);

    // 真正的字段路径下什么都拿不到——表单按这个 key 去找错误信息会拿到
    // undefined，然后什么都不渲染：不报错、不变红，只是消失。这正是本条
    // 要钉住并保持可见的那个失效模式。
    expect(index.get(realFieldPath)).toBeUndefined();
    // 唯一存在的 key 带着文件标题前缀，一眼就能看出不是表单会用的字段路径。
    expect(Array.from(index.keys())).toEqual([`社区与联系方式：${realFieldPath}`]);
  });
});

describe("contentFormKey", () => {
  test("换一个文件就换一个 key——这是防串档的那一段", () => {
    expect(contentFormKey("community", "sha1", false)).not.toBe(contentFormKey("donate", "sha1", false));
  });

  test("同一个文件、仓库版本变了也换 key", () => {
    expect(contentFormKey("community", "sha1", false)).not.toBe(contentFormKey("community", "sha2", false));
  });

  test("有草稿和没草稿是两个 key——丢弃改动后表单要回到仓库版本", () => {
    expect(contentFormKey("community", "sha1", true)).not.toBe(contentFormKey("community", "sha1", false));
  });
});
