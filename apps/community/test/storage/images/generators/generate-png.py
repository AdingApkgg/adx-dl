# Original test fixture; MIT, Copyright (c) 2026 Asuna.
import binascii,pathlib,struct,zlib
def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
width=height=32
rows=(b'\x00'+bytes((255,0,0))*width)*height
header=struct.pack('>IIBBBBB',width,height,8,2,0,0,0)
pathlib.Path('own-solid-rgb32.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b''))
