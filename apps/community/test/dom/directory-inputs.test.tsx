import type { ComponentType } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { m } from "@/paraglide/messages.js";
import Authors from "@/client/routes/authors";
import Tags from "@/client/routes/tags";
const AuthorsView=Authors as unknown as ComponentType<{loaderData:{items:never[];nextCursor:null}}>;
const TagsView=Tags as unknown as ComponentType<{loaderData:{items:never[];nextCursor:null}}>;

test.each(["authors","tags"])("UX regression: %s directory clear and Back synchronize the edited input with the URL",async kind=>{
 const View=kind==="authors"?AuthorsView:TagsView,router=createMemoryRouter([{path:"*",element:<View loaderData={{items:[],nextCursor:null}}/>}],{initialEntries:[`/${kind}?q=first&sort=recent`]});render(<RouterProvider router={router}/>);
 const name=kind==="authors"?m.discovery_authors():m.chart_metadata_tags(),field=screen.getByRole("textbox",{name}) as HTMLInputElement;
 fireEvent.change(field,{target:{value:"Edited local value"}});fireEvent.click(screen.getByRole("link",{name:m.public_charts_clear()}));
 await waitFor(()=>expect((screen.getByRole("textbox",{name}) as HTMLInputElement).value).toBe(""));
 await act(async()=>{await router.navigate(-1);});expect((screen.getByRole("textbox",{name}) as HTMLInputElement).value).toBe("first");
 if(kind==="authors")expect((screen.getByRole("combobox",{name:m.public_charts_sort()}) as HTMLSelectElement).value).toBe("recent");
});
