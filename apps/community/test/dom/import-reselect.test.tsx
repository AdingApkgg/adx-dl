import {expect,test,vi} from "vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import {ImportReselect} from "@/client/components/import-reselect";
test("recovery accepts the original explicit parts and folder groups without inventing another plan row",()=>{
 const select=vi.fn();render(<ImportReselect busy={false} onSelect={select}/>);const maidata=new File(["score"],"score.txt"),audio=new File(["audio"],"music.ogg");fireEvent.change(screen.getByLabelText("谱面文件（必选）"),{target:{files:[maidata]}});fireEvent.change(screen.getByLabelText("音乐（可选）"),{target:{files:[audio]}});fireEvent.click(screen.getByRole("button",{name:"组装并续传"}));expect(select).toHaveBeenLastCalledWith({parts:{maidata,audio}});
 const file=new File(["score"],"maidata.txt");Object.defineProperty(file,"webkitRelativePath",{value:"chart/maidata.txt"});fireEvent.change(screen.getByLabelText("添加一首谱面文件夹"),{target:{files:[file]}});expect(select).toHaveBeenLastCalledWith({folder:[file]});
});
