import json,pathlib,subprocess,concurrent.futures,hashlib,os
root=pathlib.Path(os.environ.get('BENCH_ROOT',pathlib.Path(__file__).resolve().parent))
charts=json.loads((root/'fixture.json').read_text());assets=root/'assets';assets.mkdir(exist_ok=True)
def fetch(f):
 file=assets/f['local'];url=f['url'];url='https://adxdls.saop.cc'+url if url.startswith('/') else url
 command=['curl','-fLsS','--retry','2','--max-time','180']
 if os.environ.get('BENCH_PROXY'):command+=['--proxy',os.environ['BENCH_PROXY']]
 if not file.exists() or file.stat().st_size!=f['actualBytes']:subprocess.run(command+[url,'-o',str(file)],check=True)
 assert file.stat().st_size==f['actualBytes']
 assert hashlib.sha256(file.read_bytes()).hexdigest()==f['sha256'],file.name
 print(file.name,'verified',flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,[f for c in charts for f in c['files']]))
