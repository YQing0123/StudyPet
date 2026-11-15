"""Deterministic alpha-only repairs, using reviewed 512px masks.
No colour threshold is applied to the whole animal: eyes, white paws and fur stay intact.
Identical source poses share a repair; a different pose never inherits a sitting mask.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT.parent/'MengChong_Research_20261111/research/recovered/assets'
OUT=ROOT/'scripts/patches/breeds'
DIRS={'cat_orange':'cat_frames/transparent','cat_ragdoll':'cat_frames/ragdoll/transparent','cat_black':'cat_frames/black/transparent','cat_blue':'cat_frames/blue/transparent',
'dog_dairy':'dog_frames/transparent','dog_golden':'dog_frames/golden/transparent','dog_corgi':'dog_frames/corgi/transparent','dog_german':'dog_frames/german/transparent',
**{b:f'bird_frames/{b}/transparent' for b in ['bird_parakeet','bird_cockatiel','bird_peachface','bird_pigeon']},
**{b:f'turtle_frames/{b}/transparent' for b in ['turtle_redear','turtle_grass','turtle_flower','turtle_map']}}
# Polygon boundary follows the animal; points trace the undesired floor away from toes.
FLOORS={
 'cat_black':[(0,402),(125,402),(120,419),(120,443),(133,457),(154,466),(184,473),(216,475),(238,469),(249,463),(245,452),(227,447),(204,443),(191,436),(204,440),(226,441),(229,449),(246,453),(263,452),(280,446),(303,446),(321,443),(334,436),(338,426),(332,415),(332,397),(512,397)],
 'cat_blue':[(0,397),(109,397),(110,418),(120,434),(142,438),(165,435),(173,443),(190,448),(205,447),(207,456),(223,461),(242,460),(254,454),(256,434),(272,434),(273,455),(290,462),(312,460),(321,452),(322,443),(341,443),(348,435),(349,420),(348,400),(512,400)],
 'dog_golden':[(0,412),(157,412),(160,432),(173,441),(189,439),(193,454),(208,465),(225,465),(239,458),(241,433),(272,433),(273,456),(291,468),(312,466),(324,456),(326,439),(343,441),(355,435),(356,420),(355,411),(378,407),(398,394),(408,376),(416,354),(420,343),(512,343)],
 'dog_dairy':[(0,411),(161,411),(163,434),(178,442),(193,441),(194,451),(207,459),(226,459),(238,453),(240,434),(272,434),(274,453),(290,462),(312,460),(324,451),(326,442),(341,443),(350,434),(350,423),(376,416),(391,401),(397,383),(400,366),(512,366)],
 'dog_corgi':[(0,447),(117,447),(128,461),(143,470),(174,470),(188,458),(192,478),(205,487),(229,490),(245,486),(254,477),(258,453),(292,453),(307,449),(310,464),(325,478),(346,482),(362,476),(368,466),(361,451),(352,443),(350,420),(512,420)],
 'dog_german':[(0,441),(112,441),(137,447),(161,449),(169,458),(181,463),(191,463),(190,474),(201,482),(217,484),(226,476),(230,451),(282,451),(286,476),(298,485),(318,485),(330,475),(330,463),(346,462),(353,455),(354,438),(512,438)],
 'turtle_redear':[(0,435),(147,435),(154,444),(179,449),(198,448),(209,442),(210,408),(241,409),(253,442),(267,415),(304,412),(305,441),(318,449),(345,449),(368,443),(374,435),(512,435)],
 'turtle_grass':[(0,395),(146,395),(153,409),(173,414),(192,413),(204,406),(208,387),(238,390),(255,411),(270,389),(302,389),(304,408),(319,414),(343,414),(360,407),(365,393),(512,393)],
 'turtle_flower':[(0,408),(97,408),(106,420),(137,426),(154,417),(159,387),(205,387),(211,403),(229,411),(251,410),(260,402),(299,405),(300,429),(319,438),(343,437),(355,427),(357,410),(370,420),(392,425),(412,420),(419,406),(512,406)],
 'turtle_map':[(0,403),(124,403),(130,415),(150,418),(175,415),(185,405),(192,388),(238,390),(253,416),(269,389),(327,389),(331,409),(344,418),(370,419),(391,414),(396,403),(512,403)]}
RAGDOLL=[(67,406),(72,390),(88,379),(109,375),(129,381),(137,380),(137,350),(146,328),(151,299),(160,276),(168,252),(185,228),(189,211),(194,193),(196,169),(205,144),(208,132),(201,115),(198,99),(210,100),(235,115),(254,115),(279,111),(293,87),(307,78),(317,111),(320,127),(327,143),(335,158),(343,179),(349,204),(353,237),(351,269),(355,300),(355,331),(353,361),(350,390),(341,416),(329,432),(315,442),(283,445),(248,445),(217,443),(193,446),(161,447),(127,444),(96,438),(77,430)]
report=[]
for breed,folder in DIRS.items():
 paths=sorted((SRC/folder).glob('*.png')); sit=SRC/folder/'frame-sit.png';sit_hash=hashlib.sha256(sit.read_bytes()).hexdigest()
 for path in paths:
  im=Image.open(path).convert('RGBA'); a=np.array(im); h,w=a.shape[:2]
  same=hashlib.sha256(path.read_bytes()).hexdigest()==sit_hash
  mask=Image.new('L',(512,512),255);d=ImageDraw.Draw(mask)
  method=[]
  if same and breed in FLOORS:
   pts=FLOORS[breed]; d.polygon(pts+[(512,512),(0,512)],fill=0);method.append('reviewed floor boundary')
  if breed=='cat_ragdoll':
   mask=Image.new('L',(512,512),0);ImageDraw.Draw(mask).polygon(RAGDOLL,fill=255);method.append('reviewed silhouette excluding black/teal fringe')
  if same and breed in ['bird_parakeet','bird_peachface']:
   # Keep a deliberate short perch, without source crop blocks at either end.
   keep=Image.new('L',(512,512),0);kd=ImageDraw.Draw(keep)
   kd.rounded_rectangle((110 if breed=='bird_parakeet' else 108,367,408 if breed=='bird_parakeet' else 402,458),radius=13,fill=255)
   kd.rectangle((125,0,385,512),fill=255)
   mask=keep; method.append('perch endpoints trimmed')
  if not method: continue
  mask=mask.resize((w,h),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.45))
  a[:,:,3]=np.minimum(a[:,:,3],np.array(mask))
  # Preserve DSH's eye colour repair, but not its opaque parakeet background.
  if breed=='dog_corgi' and path.name=='frame-sit.png':
   old=ROOT/'scripts/repair-sources/dog_corgi-sit-eyes.png'
   if old.exists(): a[:,:,:3]=np.array(Image.open(old).convert('RGBA'))[:,:,:3]
   # Source right paw is missing colour detail as well as alpha. Reconstruct locally
   # from the intact left forepaw; this is a symmetrical composite, not recovered pixels.
   source=Image.fromarray(a)
   paw=source.crop((188,421,257,494)).transpose(Image.Transpose.FLIP_LEFT_RIGHT).resize((53,57),Image.Resampling.LANCZOS)
   pm=Image.new('L',paw.size,0)
   ImageDraw.Draw(pm).polygon([(8,0),(42,0),(49,24),(52,43),(47,53),(32,57),(13,55),(3,46),(1,27)],fill=255)
   paw_alpha=np.minimum(np.array(paw)[:,:,3],np.array(pm.filter(ImageFilter.GaussianBlur(1.2)))).astype(float)
   paw_alpha*=np.minimum(1,np.arange(57)[:,None]/14)
   paw.putalpha(Image.fromarray(paw_alpha.astype('uint8')))
   clear=Image.new('L',(512,512),255)
   ImageDraw.Draw(clear).polygon([(348,437),(376,448),(377,492),(343,492),(343,461)],fill=0)
   a[:,:,3]=np.minimum(a[:,:,3],np.array(clear))
   source=Image.fromarray(a);source.alpha_composite(paw,(309,426));a=np.array(source)
   method.append('local mirrored forepaw reconstruction')
  target=OUT/breed/'frames'/path.name;target.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(a).save(target)
  report.append({'breed':breed,'pose':path.stem,'method':method,'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest()})
(ROOT/'scripts/patches/static-repairs.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(f'{len(report)} static alpha repairs written; source archive unchanged')
