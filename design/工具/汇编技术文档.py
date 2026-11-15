from pathlib import Path
import re,json,shutil,html
import markdown
from bs4 import BeautifulSoup
root=Path('/Users/yqing/Documents/Project/学习打卡养宠物'); d=root/'design'; out=d/'交付';out.mkdir(parents=True,exist_ok=True)
def shift(text,n):
 return re.sub(r'^(#{2,4}) (\d+)([.．].*)$',lambda m:f'{m[1]} {int(m[2])+n}{m[3]}',text,flags=re.M)
parts=[(d/'章节/01-架构与功能.md').read_text()]
t=(d/'章节/内容生产设计.md').read_text();t=re.sub(r'^# .*\n','',t,count=1);t=re.sub(r'^## (\d+)\.?\s*',lambda m:'### 4.'+m[1]+' ',t,flags=re.M)
parts.append('## 4. 教材与AI题目生产\n'+t)
for name in ['03-计划与学习流程.md','04-奖励宠物与AI.md','05-接口多端运维与验收.md','06-功能与接口清单.md','07-映射与实现细则.md']:parts.append(shift((d/'章节'/name).read_text(),1))
t=(d/'章节/数据库设计.md').read_text();t=re.sub(r'^# .*\n','',t,count=1);t=re.sub(r'^## (\d+)\.?\s*',lambda m:'### 18.'+m[1]+' ',t,flags=re.M);t=re.sub(r'^#### (.*)$',r'##### \1',t,flags=re.M);t=re.sub(r'^### (?!18\.)(.*)$',r'#### \1',t,flags=re.M)
parts.append('## 18. 数据库模型与完整数据字典\n'+t)
text='\n\n'.join(parts).replace('关系：。','').replace('"option_id": "o2"','"option_id": "40000000-0000-4000-8000-000000000005"').replace('pet_snapshot、pet_event_id和receipt','state和pet_event_id')
text=text.replace('设计交付的SQL、JSON Schema和OpenAPI是后续实现的契约，不包含已经运行的应用。','')
(out/'伴学小岛-技术详细设计.md').write_text(text,encoding='utf-8')
arch=root/'.archify/architecture-pet-island-20261106-181000/系统架构.html';shutil.copy2(arch,out/'系统架构.html')
md=markdown.Markdown(extensions=['extra','toc','sane_lists'],extension_configs={'toc':{'toc_depth':'2-2'}});body=md.convert(text);body=re.sub(r'<h1[^>]*>.*?</h1>','',body,count=1);body=re.sub(r'<table>(.*?)</table>',r'<div class="table-wrap"><table>\1</table></div>',body,flags=re.S)
base=(root/'方案/伴学小岛-完整方案.html').read_text();style=re.search(r'<style>(.*?)</style>',base,re.S)[1]
style+='\narticle h4{font-size:18px;margin-top:28px}article h5{font-size:17px;color:#245c49;margin-top:24px}aside a{font-size:13px}table{font-size:13px}pre{font-size:12px}article p{overflow-wrap:anywhere}'
# 横向溢出防护：整页兜底裁剪 + 表格容器平滑滚动 + 窄屏收紧列宽，防止宽表顶出视口
style+='main{overflow-x:clip}.table-wrap{-webkit-overflow-scrolling:touch}'
style+='@media(max-width:1080px){th,td{min-width:72px;padding:11px 12px}}'
style+='@media(max-width:760px){table{min-width:0}th,td{min-width:64px;padding:10px 11px}}'
page='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>伴学小岛技术详细设计</title><style>'+style+'</style></head><body id="top"><aside id="nav"><div class="brand">伴学小岛</div><div class="sub">技术详细设计 · v1.0</div><div class="utility"><button onclick="window.print()">打印 / 存为PDF</button><button class="mobile-nav" onclick="document.getElementById(\'nav\').classList.toggle(\'expanded\')">章节</button></div>'+md.toc+'</aside><main><header><div class="eyebrow">系统架构 · 数据模型 · 业务与接口</div><h1>伴学小岛<br>技术详细设计</h1><p>教材内容、学习证据与宠物生活共用可追溯的业务链路，支持家庭自部署和持续更新。</p><p><a href="伴学小岛-技术详细设计.docx">Word文档</a> · <a href="伴学小岛-技术详细设计.md">可编辑源稿</a> · <a href="系统架构.html">独立架构图</a></p></header><iframe title="系统架构图" src="系统架构.html" loading="lazy" sandbox="allow-scripts allow-downloads" style="width:100%;height:690px;border:1px solid #d5dfd7;border-radius:10px"></iframe><article>'+body+'</article><footer>伴学小岛 · 技术详细设计</footer></main></body></html>'
(out/'伴学小岛-技术详细设计.html').write_text(page,encoding='utf-8')
blocks=[]
for e in BeautifulSoup(body,'html.parser').children:
 name=getattr(e,'name',None)
 if not name:continue
 if re.fullmatch('h[1-6]',name):blocks.append({'type':'heading','level':int(name[1]),'text':e.get_text()})
 elif name=='p':blocks.append({'type':'paragraph','text':e.get_text()})
 elif name in ['ul','ol']:
  blocks.extend({'type':'bullet','text':li.get_text()} for li in e.find_all('li',recursive=False))
 elif name=='pre':blocks.append({'type':'code','text':e.get_text()})
 elif name=='div' and e.find('table'):
  rows=[[td.get_text() for td in tr.find_all(['td','th'],recursive=False)] for tr in e.find('table').find_all('tr')];blocks.append({'type':'table','rows':rows})
(d/'文档构建数据.json').write_text(json.dumps({'title':'伴学小岛技术详细设计','blocks':blocks},ensure_ascii=False),encoding='utf-8')
soup=BeautifulSoup(page,'html.parser');ids={x['id'] for x in soup.find_all(id=True)};anchors=[a['href'][1:] for a in BeautifulSoup(md.toc,'html.parser').find_all('a')];assert all(x in ids for x in anchors)
print(json.dumps({'characters':len(text),'chapters':len(anchors),'tables':sum(x['type']=='table' for x in blocks),'blocks':len(blocks)},ensure_ascii=False))
