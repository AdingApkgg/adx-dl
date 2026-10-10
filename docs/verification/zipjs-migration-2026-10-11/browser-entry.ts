import { buildNestedArchiveBlob, saveBlobAsFile } from '../../../apps/web/src/lib/adx-archive';
import { releaseArchiveBlob } from '../../../apps/web/src/lib/adx-archive-storage';
let output: Blob;
Object.assign(window, {
  async pack(fixture: {dir: string; files: {name: string; local: string}[]}[]) {
    const files = Array.from(document.querySelector('input')!.files!);
    output = await buildNestedArchiveBlob(fixture.map(chart => ({ name: chart.dir,
      files: chart.files.map(file => ({name: file.name, blob: files.find(input => input.name === file.local)!})) })), 'adx');
    return {diskBacked: output instanceof File, size: output.size, type: output.type};
  },
  async release() { await releaseArchiveBlob(output); },
});
document.querySelector('button')!.addEventListener('click', () => saveBlobAsFile(output, '谱面-BGA.adx'));
