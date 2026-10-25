import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { RouteFeedback } from "@/client/components/route-feedback";

function fixture(dialog = false) {
  let resolve!: (value: null) => void;
  const deferred = new Promise<null>(done => { resolve = done; });
  const router = createMemoryRouter([{ element: <><RouteFeedback />{dialog ? <section role="dialog" aria-modal="true"><input aria-label="Dialog input" /></section> : null}<div id="main-content" tabIndex={-1}><Outlet /></div></>, children: [
    { path: "/editor", element: <main><h1>Editor</h1><input aria-label="Draft" defaultValue="Unsaved" /><Link to="/next">Next</Link></main> },
    { path: "/next", loader: () => deferred, element: <main><h1>Next page</h1></main> },
    { path: "/other", element: <main><h1>Other page</h1></main> },
  ] }], { initialEntries: ["/editor"] });
  render(<RouterProvider router={router} />); return { router, resolve };
}
test("a slow loader shows indeterminate progress while retaining the old form, then focuses committed content", async () => {
  const { resolve } = fixture(), input = screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Local draft remains" } }); fireEvent.click(screen.getByRole("link", { name: "Next" }));
  await screen.findByRole("progressbar"); expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input); expect(input.value).toBe("Local draft remains");
  await act(async () => { resolve(null); }); await screen.findByRole("heading", { name: "Next page" });
  await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull()); await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main-content")));
});
test("query and hash edits preserve the input instance and focus", async () => {
  const { router } = fixture(), input = screen.getByRole("textbox", { name: "Draft" }); input.focus();
  await act(async () => { await router.navigate("/editor?q=updated#section"); });
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input); expect(document.activeElement).toBe(input);
});
test("cancelling a pending navigation removes progress and ignores its eventual result", async () => {
  const { router, resolve } = fixture(); fireEvent.click(screen.getByRole("link", { name: "Next" })); await screen.findByRole("progressbar");
  await act(async () => { await router.navigate("/other"); }); await act(async () => { resolve(null); });
  expect(screen.getByRole("heading", { name: "Other page" })).toBeTruthy(); expect(screen.queryByRole("progressbar")).toBeNull();
});
test("an open global dialog retains focus across a pathname navigation", async () => {
  const { router } = fixture(true), input = screen.getByRole("textbox", { name: "Dialog input" }); input.focus();
  await act(async () => { await router.navigate("/other"); }); await new Promise(requestAnimationFrame);
  expect(document.activeElement).toBe(input);
});
