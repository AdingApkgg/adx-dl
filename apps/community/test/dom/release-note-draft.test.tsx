import {expect,test,vi} from "vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import type {ChartDto} from "@/shared/charts";
import {ReleaseNoteDraft} from "@/client/components/release-note-draft";
const version={id:"11111111-1111-4111-a111-111111111111",ordinal:1,releaseNote:"",sourceFileId:"file",sourceSize:1,createdAt:"",summary:{title:"",artist:"",maidataMd5Base64:"",difficulties:[],warnings:[],audio:null,hasCover:false}};
const chart={id:"22222222-2222-4222-a222-222222222222",revision:1,title:"",artist:"",description:"",credits:"",tags:[],currentVersionId:version.id,versions:[version],createdAt:"",updatedAt:""} as ChartDto;
test("dirty release note never adopts a fresh revision without explicit conflict review",async()=>{
 const saved=vi.fn(async()=>{}),view=render(<ReleaseNoteDraft chart={chart} right={version} analysis={null} onSaved={saved}/>);
 fireEvent.change(screen.getByRole("textbox",{name:"所选版本更新说明"}),{target:{value:"my unsaved note"}});
 const remote={...version,releaseNote:"other tab note"};view.rerender(<ReleaseNoteDraft chart={{...chart,revision:2,versions:[remote]}} right={remote} analysis={null} onSaved={saved}/>);
 expect((screen.getByRole("button",{name:"保存更新说明"}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText("other tab note",{exact:true})).toBeTruthy();expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("my unsaved note");expect(saved).not.toHaveBeenCalled();
});
