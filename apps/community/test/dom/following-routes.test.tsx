import { QueryClientProvider } from "@tanstack/react-query";
import { render,screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect,test } from "vitest";
import { makeQueryClient } from "@/shared/query-client";
import Following from "@/client/routes/following";
import FollowingFeed from "@/client/routes/following-feed";
import { m } from "@/paraglide/messages.js";
function wrap(component:React.ReactNode,meId="viewer"){const client=makeQueryClient();client.setQueryData(["me"],{id:meId,publicId:"1",status:"active"});return render(<QueryClientProvider client={client}><RouterProvider router={createMemoryRouter([{path:"*",element:component}])}/></QueryClientProvider>);}
test("private following empty state links to feed without exposing another account",()=>{
 wrap(<Following loaderData={{userId:"viewer",page:{items:[],nextCursor:null}}} params={{}} matches={[] as never}/>);
 expect(screen.getByText(m.following_empty())).toBeTruthy();expect(screen.getByRole("link",{name:m.following_feed_title()}).getAttribute("href")).toBe("/me/feed");
});
test("feed distinguishes filtered pages from a genuinely empty window",()=>{
 wrap(<FollowingFeed loaderData={{userId:"viewer",page:{items:[],nextCursor:"next-page"}}} params={{}} matches={[] as never}/>);
 expect(screen.getByText(m.following_feed_filtered())).toBeTruthy();
});
test("mismatched account cannot render retained private page rows",()=>{
 wrap(<FollowingFeed loaderData={{userId:"original-viewer",page:{items:[],nextCursor:null}}} params={{}} matches={[] as never}/>);
 expect(screen.queryByRole("heading",{name:m.following_feed_title()})).toBeNull();
});
