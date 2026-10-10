import { useDownloadsStore, newBatchJobId } from '../../../apps/web/src/components/site/downloads/downloads-store';
const fixture = await (await fetch('/fixture.json')).json();
let requests = 0;
const originalFetch = window.fetch.bind(window);
window.fetch = ((input, init) => {
  if (String(input).includes('/assets/')) requests++;
  return originalFetch(input, init);
}) as typeof fetch;
let ids: string[] = [];
Object.assign(window, {
  async startQueue() {
    useDownloadsStore.getState().setMaidataPreciseLevels(false);
    ids = await useDownloadsStore.getState().startBatch({
      id: newBatchJobId(), title: 'BGA Version', includeVideo: true, format: 'adx', individual: new URLSearchParams(location.search).has('individual'),
      charts: fixture.map((chart: any) => ({dir: chart.dir, groupDir: 'BGA Version', files: chart.files.map((file: any) => ({name: file.name, url: `${location.origin}/assets/${file.local}`, bytes: file.actualBytes}))})),
    });
    return ids;
  },
  queueState() {
    const jobs = useDownloadsStore.getState().jobs;
    return {requests, initialIds: ids, jobs: jobs.map(job => ({id: job.id, parent: job.fallbackParentId,
      status: job.status, total: job.total, error: job.error,
      archives: job.archives?.map(archive => ({fileName: archive.fileName,bytes: archive.bytes,requested:archive.requested})),
    })), historyCount: useDownloadsStore.getState().history.length};
  },
  confirmQueue(id: string) { return useDownloadsStore.getState().confirmSavedBatch(id); },
});
document.querySelector('button')!.addEventListener('click', () => {
  const job = useDownloadsStore.getState().jobs.find(job => job.status === 'ready');
  if (job) useDownloadsStore.getState().saveArchive(job.id, 0);
});
