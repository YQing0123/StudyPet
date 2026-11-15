from pathlib import Path
import json,re
from docx import Document
from docx.shared import Inches,Pt,Cm,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
root=Path('/Users/yqing/Documents/Project/学习打卡养宠物/design')
data=json.loads((root/'文档构建数据.json').read_text(encoding='utf-8'))
doc=Document();sec=doc.sections[0];sec.page_width=Cm(21);sec.page_height=Cm(29.7);sec.top_margin=Cm(2);sec.bottom_margin=Cm(1.8);sec.left_margin=Cm(1.8);sec.right_margin=Cm(1.8)
for name in ['Normal','Body Text','List Bullet','Heading 1','Heading 2','Heading 3','Heading 4','Title']:
 st=doc.styles[name];st.font.name='Arial';st._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'宋体');st.font.size=Pt(10 if name in ['Normal','Body Text','List Bullet'] else 13)
doc.styles['Normal'].paragraph_format.space_after=Pt(5);doc.styles['Normal'].paragraph_format.line_spacing=1.22
for i,size in [(1,17),(2,13),(3,11),(4,10.5)]:
 st=doc.styles[f'Heading {i}'];st.font.size=Pt(size);st.font.color.rgb=RGBColor.from_string('245C49');st.paragraph_format.space_before=Pt(13);st.paragraph_format.space_after=Pt(6);st.paragraph_format.keep_with_next=True
p=doc.add_paragraph();p.paragraph_format.space_before=Pt(85);r=p.add_run('伴学小岛');r.bold=True;r.font.size=Pt(32);r.font.color.rgb=RGBColor.from_string('245C49')
p=doc.add_paragraph();r=p.add_run('技术详细设计');r.bold=True;r.font.size=Pt(25)
doc.add_paragraph('教材内容 · 学习验证 · 宠物生活 · 家庭部署')
doc.add_paragraph('版本 1.0')
doc.add_page_break();doc.add_heading('目录',level=1)
for b in data['blocks']:
 if b['type']=='heading' and b['level']==2:doc.add_paragraph(b['text'])
doc.add_page_break()
header=sec.header.paragraphs[0];header.add_run('伴学小岛｜技术详细设计').font.size=Pt(9)
p=sec.footer.paragraphs[0];p.alignment=2;p.add_run('第 ')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');p._p.append(fld);p.add_run(' 页')

def font(run,size=9,bold=False):
 run.font.name='Arial';run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'宋体');run.font.size=Pt(size);run.bold=bold
for b in data['blocks']:
 t=b['type']
 if t=='heading':
  if b['level']==1:continue
  p=doc.add_heading(b['text'],level=min(b['level']-1,4))
  if b['level']==2 and b['text'].startswith(('4.','5.','7.','10.','15.','16.','18.')):p.paragraph_format.page_break_before=True
 elif t=='paragraph':doc.add_paragraph(b['text'])
 elif t=='bullet':doc.add_paragraph(b['text'],style='List Bullet')
 elif t=='code':
  p=doc.add_paragraph();p.paragraph_format.space_before=Pt(4);p.paragraph_format.space_after=Pt(6)
  shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'EEF3EC');p._p.get_or_add_pPr().append(shade)
  r=p.add_run(b['text']);r.font.name='Consolas';r._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'宋体');r.font.size=Pt(8)
 elif t=='table':
  rows=b['rows']
  if not rows:continue
  n=max(len(x) for x in rows);table=doc.add_table(rows=0,cols=n);table.style='Table Grid';table.autofit=False
  # relative widths chosen by table semantics, always within writable width.
  head=rows[0]
  if head[:2]==['字段','类型']:weights=[2.8,2.5,0.8,6.1][:n]
  elif n==5 and head[0] in ['operation_id','功能ID']:weights=[2.5,3.8,1.2,1.0,4.0] if head[0]=='operation_id' else [1.1,1.7,3.2,0.7,5.2]
  else:weights=[1]*n
  total=sum(weights);width=17.4
  for col,w in zip(table.columns,weights):col.width=Cm(width*w/total)
  for ri,row in enumerate(rows):
   cells=table.add_row().cells
   for ci,cell in enumerate(cells):
    cell.width=Cm(width*weights[ci]/total);cell.vertical_alignment=0
    p=cell.paragraphs[0];p.paragraph_format.space_after=Pt(3);p.paragraph_format.space_before=Pt(2);p.paragraph_format.line_spacing=1.08
    r=p.add_run(row[ci] if ci<len(row) else '');font(r,8.2 if n>=5 else 8.8,ri==0)
    if ri==0:
     sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'E7EFE5');cell._tc.get_or_add_tcPr().append(sh)
   trPr=table.rows[-1]._tr.get_or_add_trPr();cant=OxmlElement('w:cantSplit');trPr.append(cant)
   if ri==0:
    repeat=OxmlElement('w:tblHeader');repeat.set(qn('w:val'),'true');trPr.append(repeat)
  doc.add_paragraph().paragraph_format.space_after=Pt(2)
path=root/'交付/伴学小岛-技术详细设计.docx';doc.save(path)
check=Document(path);assert len(check.tables)==sum(b['type']=='table' for b in data['blocks']);assert any('18. 数据库' in p.text for p in check.paragraphs)
print(json.dumps({'path':str(path),'paragraphs':len(check.paragraphs),'tables':len(check.tables),'sections':len(check.sections),'bytes':path.stat().st_size},ensure_ascii=False))
