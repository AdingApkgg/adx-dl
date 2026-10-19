import {expect,test,vi} from "vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import {SimaiSource} from "../../src/client/components/simai-source";
const analysis={algorithm:1,difficulty:4 as const,following:true,diagnostics:[],bpm:[],firstMs:0,noteCount:2,error:null,statements:[{start:0,end:1,line:1,column:1,seconds:2,beat:4},{start:2,end:3,line:2,column:1,seconds:2.5,beat:5}]};
test("source seeks use buttons and never request automatic playback; manual scrolling pauses follow",()=>{
 const seek=vi.fn();render(<SimaiSource source={"1\n2"} analysis={analysis} position={2} onSeek={seek}/>);
 const button=screen.getByRole("button",{name:/1:1.*2.000/});fireEvent.click(button);expect(seek).toHaveBeenCalledWith(2);
 fireEvent.wheel(screen.getByTestId("source-viewport"));expect(screen.getByText("手动滚动已暂停跟随")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"恢复跟随"}));expect(screen.queryByText("手动滚动已暂停跟随")).toBeNull();
});
test("unmapped/unsupported source stays visible without invented seek actions",()=>{
 render(<SimaiSource source="&title=Unsupported" analysis={{...analysis,error:"PREVIEW_UNSUPPORTED",following:false,statements:[]}} position={0}/>);
 expect(screen.getByText("&title=Unsupported")).toBeTruthy();expect(screen.queryByRole("button",{name:/0.000/})).toBeNull();
});

test("diagnostics locate original source lines and seeks beyond preview duration stay disabled",()=>{
 const seek=vi.fn(),source=Array.from({length:40},(_,i)=>`source line ${i+1}`).join("\n");
 const {rerender}=render(<SimaiSource source={source} analysis={analysis} position={0} onSeek={seek} seekLimit={2}/>);
 expect(screen.getByRole("button",{name:/2:1.*2.500/}).hasAttribute("disabled")).toBe(true);
 rerender(<SimaiSource source={source} analysis={analysis} position={0} onSeek={seek} seekLimit={2} focusLine={{line:30,token:1}}/>);
 expect(screen.getByText("source line 30")).toBeTruthy();expect(screen.getByText("手动滚动已暂停跟随")).toBeTruthy();
});
