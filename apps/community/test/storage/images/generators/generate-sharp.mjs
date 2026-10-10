// Original synthetic test fixtures; MIT, Copyright (c) 2026 Asuna.
import sharp from 'sharp';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='/fixture-output'; sharp.cache(false); sharp.concurrency(1);
const rgba=Buffer.alloc(80*160*3);for(let y=0;y<160;y++)for(let x=0;x<80;x++)rgba[(y*80+x)*3+(y<80?0:2)]=255;
const raw={width:80,height:160,channels:3};
await sharp(rgba,{raw}).toColourspace('cmyk').jpeg({quality:90,chromaSubsampling:'4:4:4',progressive:false}).toFile(root+'/own-cmyk.jpg');
const xmp='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="Own synthetic storage fixture"/></rdf:RDF></x:xmpmeta>';
await sharp(rgba,{raw}).withMetadata({orientation:6}).withExifMerge({IFD0:{Artist:'Own synthetic storage fixture'},IFD3:{GPSLatitudeRef:'N',GPSLatitude:'0/1 0/1 0/1',GPSLongitudeRef:'E',GPSLongitude:'0/1 0/1 0/1'}}).withXmp(xmp).jpeg({quality:90,chromaSubsampling:'4:4:4',progressive:false}).toFile(root+'/own-gps-orientation6.jpg');
function exifValues(exif){
 if(exif.toString('ascii',0,6)!=='Exif\0\0')throw Error('EXIF header absent');
 const b=exif.subarray(6),le=b.toString('ascii',0,2)==='II'; if(!le&&b.toString('ascii',0,2)!=='MM')throw Error('TIFF endian');
 const u16=o=>le?b.readUInt16LE(o):b.readUInt16BE(o),u32=o=>le?b.readUInt32LE(o):b.readUInt32BE(o);
 if(u16(2)!==42)throw Error('TIFF magic');
 function ifd(o){const n=u16(o);if(n>64||o+2+n*12+4>b.length)throw Error('IFD bounds');const v={};for(let i=0;i<n;i++){const at=o+2+i*12,tag=u16(at),type=u16(at+2),count=u32(at+4);if(count>1024)throw Error('EXIF count');const sizes={1:1,2:1,3:2,4:4,5:8};if(!sizes[type])continue;const bytes=count*sizes[type],start=bytes<=4?at+8:u32(at+8);if(start+bytes>b.length)throw Error('EXIF bounds');let val;if(type===2)val=b.toString('ascii',start,start+bytes).replace(/\0+$/,'');else if(type===5)val=Array.from({length:count},(_,j)=>[u32(start+j*8),u32(start+j*8+4)]);else if(type===3)val=u16(start);else if(type===4)val=u32(start);else val=[...b.subarray(start,start+bytes)];v[tag]=val;}return v;}
 const main=ifd(u32(4));return {orientation:main[0x112],artist:main[0x13b],gps:ifd(main[0x8825])};
}
const fields=m=>({format:m.format,width:m.width,height:m.height,space:m.space,channels:m.channels,pages:m.pages,compression:m.compression,orientation:m.orientation,exif:!!m.exif,icc:!!m.icc,xmp:!!m.xmp,iptc:!!m.iptc,isProgressive:!!m.isProgressive});
const results={runtime:{platform:process.platform,arch:process.arch,bun:process.versions.bun,versions:sharp.versions},inputs:{},outputs:{}};
async function hash(path){return {bytes:(await stat(path)).size,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
for(const name of ['own-cmyk.jpg','own-gps-orientation6.jpg']){
 const path=root+'/'+name,m=await sharp(path,{failOn:'warning',limitInputPixels:16000000}).metadata();results.inputs[name]={...fields(m),...await hash(path)};
 if(name==='own-cmyk.jpg'&&(m.space!=='cmyk'||m.channels!==4))throw Error('Native input not CMYK');
 if(name==='own-gps-orientation6.jpg'){const tags=exifValues(m.exif);if(tags.orientation!==6||tags.gps[1]!=='N'||tags.gps[3]!=='E'||JSON.stringify(tags.gps[2])!=='[[0,1],[0,1],[0,1]]'||JSON.stringify(tags.gps[4])!=='[[0,1],[0,1],[0,1]]')throw Error('Synthetic GPS/orientation missing');results.inputs[name].parsedExif=tags;}
 const out=root+'/'+name.replace('.jpg','.recipe.jpg');await sharp(path,{failOn:'warning',limitInputPixels:16000000}).rotate().toColourspace('srgb').resize(512,512,{fit:'cover',position:'centre'}).flatten({background:'#ffffff'}).jpeg({quality:85,progressive:false}).toFile(out);
 const om=await sharp(out).metadata(),oh=await hash(out);if(om.format!=='jpeg'||om.width!==512||om.height!==512||om.space!=='srgb'||oh.bytes>524288||om.exif||om.icc||om.xmp||om.iptc||om.isProgressive)throw Error('Recipe invalid');
 const {data,info}=await sharp(out).raw().toBuffer({resolveWithObject:true});const pixels=name==='own-cmyk.jpg'?[[256,128],[256,384]]:[[128,256],[384,256]];const sampled=pixels.map(([x,y])=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)]);const expected=name==='own-cmyk.jpg'?[[232,0,0],[28,60,139]]:[[0,0,255],[255,0,0]];sampled.forEach((v,i)=>v.forEach((value,c)=>{if(Math.abs(value-expected[i][c])>4)throw Error('CMYK conversion/rotation pixel mismatch');}));results.outputs[name]={...fields(om),...oh,pixels,sampled};
}
const heic=await sharp(root+'/own-solid-rgb32.heic').metadata();if(heic.format!=='heif'||heic.compression!=='hevc'||heic.width!==32||heic.height!==32||(heic.pages??1)!==1)throw Error('Own HEIC native metadata incorrect');results.inputs['own-solid-rgb32.heic']={...fields(heic),...await hash(root+'/own-solid-rgb32.heic'),policyExpected:'UNSUPPORTED_FORMAT'};
const decoded=await sharp(root+'/own-solid-rgb32.decoded.png').raw().toBuffer({resolveWithObject:true});if(decoded.info.width!==32||decoded.info.height!==32)throw Error('Independent HEVC decode size');results.heicDecode={...decoded.info,firstPixel:[...decoded.data.subarray(0,3)]};
results.resourceUsage=process.resourceUsage();await writeFile(root+'/own-sharp-result.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
