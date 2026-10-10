import pathlib,json,subprocess,os,hashlib,base64,tarfile
root=pathlib.Path(os.environ.get('BENCH_ROOT',pathlib.Path(__file__).resolve().parent))
for dep in json.loads((root/'dependencies.json').read_text()):
 archive=root/(dep['directory']+'.tgz');command=['curl','-fLsS','--max-time','120']
 if os.environ.get('BENCH_PROXY'):command+=['--proxy',os.environ['BENCH_PROXY']]
 subprocess.run(command+[dep['tarball'],'-o',str(archive)],check=True)
 assert 'sha512-'+base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()==dep['integrity']
 folder=root/dep['directory'];folder.mkdir(exist_ok=True)
 with tarfile.open(archive) as tar:tar.extractall(folder,filter='data')
 print(dep['name'],dep['version'],'verified')
