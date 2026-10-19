import { expect, test } from "bun:test";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { safeDiscussionHref } from "./discussion-ui";

test("notification links localize both private ticket routes while rejecting untrusted destinations", async () => {
  for (const prefix of ["", "/en", "/ja"]) {
    await paraglideMiddleware(new Request(`https://community.test${prefix}/me/notifications`), async () => {
      expect(safeDiscussionHref("/me/library?view=reports")).toBe(`${prefix}/me/library?view=reports`);
      expect(safeDiscussionHref("/me/reports")).toBe(`${prefix}/me/reports`);
      expect(safeDiscussionHref("/me/discussions?kind=reports")).toBe(`${prefix}/me/discussions?kind=reports`);
      expect(safeDiscussionHref("/forum/1#message-abc")).toBe(`${prefix}/forum/1#message-abc`);
      for (const href of ["https://evil.test", "//evil.test", "/dash", "/me/reports?next=https://evil.test", null]) expect(safeDiscussionHref(href)).toBeNull();
      return new Response();
    });
  }
});
