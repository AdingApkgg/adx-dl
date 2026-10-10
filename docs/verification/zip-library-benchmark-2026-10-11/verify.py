import pathlib,json,zipfile,hashlib,struct,re
root=pathlib.Path(__file__).resolve().parent
fixture=json.loads((root/'fixture.json').read_text())
results=[]
for archive in sorted(root.glob('*.adx')):
 match=re.search(r'-(\d+)-(blob|opfs)-',archive.name)
 if not match: continue
 repeats=int(match[1]);expected={f'Test {r+1}/{c["dir"]}/{f["name"]}':f for r in range(repeats) for c in fixture for f in c['files']}
 result={'archive':archive.name,'bytes':archive.stat().st_size}
 try:
  with zipfile.ZipFile(archive) as z:
   assert set(z.namelist())==set(expected) and len(z.infolist())==len(expected)
   result['versionsNeeded']=sorted(set(i.extract_version for i in z.infolist()))
   result['compressionMethods']=sorted(set(i.compress_type for i in z.infolist()))
   result['zip64CentralEntries']=sum(b'\x01\x00' in i.extra[:2] for i in z.infolist())
   for i in z.infolist():
    assert i.file_size==expected[i.filename]['actualBytes']
    h=hashlib.sha256()
    with z.open(i) as f:
     while chunk:=f.read(1024*1024):h.update(chunk)
    assert h.hexdigest()==expected[i.filename]['sha256'],i.filename
   result['verifiedEntries']=len(expected)
  with archive.open('rb') as f:
   f.seek(max(0,result['bytes']-1024));footer=f.read()
  result['zip64EOCD']=b'PK\x06\x06' in footer and b'PK\x06\x07' in footer
  result['pass']=True
 except Exception as e:result['pass']=False;result['error']=str(e)
 results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
(root/'integrity.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
