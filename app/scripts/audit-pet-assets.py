"""Generate actual decoded contact sheets, bounds and machine-readable inventory.
Run after copy-pet-assets.mjs. ffmpeg/libvpx-vp9, Pillow/numpy required.
"""
from pathlib import Path
import json,subprocess,hashlib,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];PETS=ROOT/'web/public/pets'
OUT=ROOT.parent/'output/continuation-20261113/asset-audit';OUT.mkdir(parents=True,exist_ok=True)
manifest=json.loads((PETS/'manifest.json').read_text())
report=json.loads((OUT/'inventory.json').read_text()) if (OUT/'inventory.json').exists() else {}
metadata=json.loads((ROOT/'scripts/asset-bounds.json').read_text()) if (ROOT/'scripts/asset-bounds.json').exists() else {}
font=ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc',17)
def key(a,mode):
 if mode=='alpha':return a
 rgb=a[:,:,:3].astype(float)/255;idx=2 if mode=='blue' else 1;dom=rgb[:,:,idx]-np.max(np.delete(rgb,idx,axis=2),axis=2)
 alpha=np.clip((.17-dom)/.11,0,1);alpha=alpha*alpha*(3-2*alpha);a[:,:,3]=np.round(alpha*255).astype('uint8')
 rgb[:,:,idx]-=np.clip(dom*2.2,0,1)*1.2;a[:,:,:3]=np.round(np.clip(rgb,0,1)*255).astype('uint8');return a
for breed,info in manifest['breeds'].items():
 if len(sys.argv)>1 and breed not in sys.argv[1:]:continue
 rows=[];meta={'frames':{},'videos':{}};sheet=Image.new('RGB',(840,13*230),(239,232,216));d=ImageDraw.Draw(sheet)
 for pose in info['frames']:
  a=np.array(Image.open(PETS/pose['file']).convert('RGBA'));ys=np.where((a[:,:,3]>32).sum(axis=1)>2)[0];meta['frames'][pose['key']]={'bottom':float((ys[-1]+1)/a.shape[0]) if len(ys) else 1}
 for i,(action,entry) in enumerate(info['videos'].items()):
  path=PETS/entry['file'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(path)]));duration=float(probe['format']['duration']);bottoms=[]
  for j,t in enumerate([0,duration*.5,max(0,duration-.09)]):
   raw=subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-ss',str(t),'-i',str(path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-']);a=np.frombuffer(raw,np.uint8).reshape(512,512,4).copy();a=key(a,entry['mode']);alpha=a[:,:,3].astype(float)
   mass=alpha.sum(axis=1);ys=np.where(np.cumsum(mass)>=mass.sum()*.998)[0];bottoms.append(float((ys[0]+1)/512) if len(ys) else 1)
   im=Image.fromarray(a);im.thumbnail((220,208));bg=Image.new('RGB',(280,230),(244,237,222) if j!=1 else (46,54,63));bg.paste(im,((280-im.width)//2,0),im);sheet.paste(bg,(j*280,i*230));d.text((j*280+6,i*230+207),f'{action} {t:.2f}s',font=font,fill=(40,50,50) if j!=1 else (240,235,220))
  meta['videos'][action]={'bottom':max(bottoms)}
  rows.append({'action':action,'mode':entry['mode'],'duration':duration,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 sheet.save(OUT/(breed+'.jpg'),quality=90);report[breed]={'name':info['name'],'videos':rows};metadata[breed]=meta;print(breed,flush=True)
(OUT/'inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));(ROOT/'scripts/asset-bounds.json').write_text(json.dumps(metadata,indent=2))
print('Completed decoded first/mid/end sheets for requested breeds')
