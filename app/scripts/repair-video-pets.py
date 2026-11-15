"""Conservative spatial repairs for reviewed VP9 clips.
Corgi walking: inpaint cyan contamination inside the existing animal matte.
Parakeet perched clips: remove corner remnants and trim the ends of the perch.
RGB inpaint is explicitly a reconstruction, not recovered source detail.
"""
from pathlib import Path
import json,subprocess,sys
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[1];PETS=ROOT/'web/public/pets';SRC=ROOT.parent/'MengChong_Research_20261111/research/recovered/assets'
manifest=json.loads((PETS/'manifest.json').read_text());report=[]
def decode(path):
 raw=subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(path),'-f','rawvideo','-pix_fmt','rgba','-']);return np.frombuffer(raw,np.uint8).reshape(-1,512,512,4).copy()
def encode(frames,path,source):
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate','-of','json',str(source)]));fps=probe['streams'][0]['r_frame_rate'];path.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','512x512','-r',fps,'-i','-','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0',str(path)],input=frames.tobytes(),check=True)
for breed,actions in {'dog_corgi':['walk','walk-start','walk-stop'],'bird_parakeet':['greet','eat','eatrev','sleep','wake','walk-start','walk-stop']}.items():
 if len(sys.argv)>1 and breed!=sys.argv[1]:continue
 for action in actions:
  if len(sys.argv)>2 and action not in sys.argv[2:]:continue
  entry=manifest['breeds'][breed]['videos'][action]
  source=SRC/'videos'/breed/(action+'.alpha.webm')
  source_mode='alpha' if source.exists() else ('green' if breed=='dog_corgi' else 'blue')
  if not source.exists():source=SRC/'videos'/breed/(action+'.webm')
  frames=decode(source);changed=0
  for frame in frames:
   if breed=='dog_corgi':
    rgb=frame[:,:,:3];r,g,b=[rgb[:,:,i].astype('int16') for i in range(3)]
    if source_mode=='green':
     dom=(g-np.maximum(r,b))/255;alpha=np.clip((.17-dom)/.11,0,1);alpha=alpha*alpha*(3-2*alpha);frame[:,:,3]=np.round(alpha*255).astype('uint8')
    matte=(frame[:,:,3]>160).astype('uint8')
    closed=cv2.morphologyEx(matte,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(55,55)))
    closed[370:]=matte[370:]
    contours,_=cv2.findContours(closed,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    interior=np.zeros((512,512),np.uint8)
    if contours:cv2.drawContours(interior,[max(contours,key=cv2.contourArea)],-1,255,cv2.FILLED)
    mask=((g>r+25)&(interior>0)).astype('uint8')*255
    frame[:,:,3][mask>0]=255
    changed+=np.count_nonzero(mask)
    neutral=rgb.copy();neutral[interior==0]=[245,241,231]
    restored=cv2.inpaint(neutral,mask,5,cv2.INPAINT_TELEA)
    restored[:,:,1]=np.minimum(restored[:,:,1].astype('int16'),np.maximum(restored[:,:,0],restored[:,:,2]).astype('int16')+5).astype('uint8')
    frame[:,:,:3]=restored
   else:
    if source_mode!='alpha':
     rgb=frame[:,:,:3].astype(float)/255;dom=rgb[:,:,2]-np.maximum(rgb[:,:,0],rgb[:,:,1]);a=np.clip((.17-dom)/.11,0,1);a=a*a*(3-2*a);frame[:,:,3]=np.round(a*255).astype('uint8');rgb[:,:,2]=np.minimum(rgb[:,:,2],np.maximum(rgb[:,:,0],rgb[:,:,1])+.025);frame[:,:,:3]=np.round(rgb*255).astype('uint8')
    # These seven clips keep the bird centred; flying and floor-play clips are excluded.
    before=frame[:,:,3].copy();frame[330:, :85, 3]=0;frame[330:, 430:, 3]=0
    # Eat/reverse retain a detached grey mounting block left of the short perch.
    # It sits outside the bird and perch throughout these two stationary clips.
    if action in ['eat','eatrev']:frame[410:460, :135, 3]=0
    r,g,b=[frame[:,:,i].astype('int16') for i in range(3)];yy,xx=np.mgrid[:512,:512];remnant=(g>r+30)&(b>r+25)&((xx<145)|(xx>395))&(yy>320);frame[:,:,3][remnant]=0
    n,labels,stats,_=cv2.connectedComponentsWithStats((frame[:,:,3]>16).astype('uint8'),8)
    for label in range(1,n):
     if stats[label,cv2.CC_STAT_AREA]<100:frame[:,:,3][labels==label]=0
    changed+=np.count_nonzero(before!=frame[:,:,3])
  file=f'videos/{breed}/{action}.alpha.webm';target=ROOT/'scripts/patches'/file;encode(frames,target,source)
  report.append({'breed':breed,'action':action,'frames':len(frames),'changedPixels':int(changed),'output':file,'mode':'alpha'});print(breed,action,len(frames),flush=True)
record=ROOT/'scripts/patches/video-repairs.json'
if len(sys.argv)>1 and record.exists():
 processed={(r['breed'],r['action']) for r in report}
 report=[r for r in json.loads(record.read_text()) if (r['breed'],r['action']) not in processed]+report
record.write_text(json.dumps(report,indent=2))
