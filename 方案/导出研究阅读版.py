from pathlib import Path
import html
import re
import json
import markdown
from html.parser import HTMLParser
root = Path('/Users/yqing/Documents/Project/学习打卡养宠物/方案')
source = root / '伴学小岛-开源参考与内容体系优化报告.md'
base = (root / '伴学小岛-完整方案.html').read_text(encoding='utf-8')
style = re.search(r'<style>(.*?)</style>', base, re.S).group(1)
md = markdown.Markdown(extensions=['extra', 'toc', 'sane_lists'], extension_configs={'toc': {'toc_depth':'2-2'}})
body = md.convert(source.read_text(encoding='utf-8'))
body = re.sub(r'<h1[^>]*>.*?</h1>', '', body, count=1)
body = re.sub(r'<table>(.*?)</table>',r'<div class="table-wrap"><table>\1</table></div>',body,flags=re.S)
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>伴学小岛 · 开源参考与内容体系优化</title><style>''' + style + '''</style></head><body id="top"><aside id="nav"><div class="brand">伴学小岛</div><div class="sub">开源参考 · 内容生产 · 方案优化</div><div class="utility"><button type="button" onclick="window.print()">打印 / 存为 PDF</button><button type="button" class="mobile-nav" aria-expanded="false" onclick="document.getElementById('nav').classList.toggle('expanded');this.setAttribute('aria-expanded',document.getElementById('nav').classList.contains('expanded'))">章节</button></div>''' + md.toc + '''<a href="#top" id="top-link">返回顶部</a></aside><main><header><div class="eyebrow">开源参考与内容体系优化</div><h1>内容有出处，<br>挑战有质量。</h1><p>复用成熟能力，建立教材导入、语义切片、AI出题、质量检查和学习证据的完整链路。</p><div class="core-flow"><span>开源学习项目</span><span>相似应用</span><span>Skills与框架</span><span>内容质量</span><span>方案缺口</span></div></header><article>''' + body + '''</article><footer>伴学小岛 · 开源参考与内容体系优化</footer></main></body></html>'''
output = root / '伴学小岛-开源参考与内容体系优化报告.html'
output.write_text(page,encoding='utf-8')
class Check(HTMLParser):
    def __init__(self): super().__init__(); self.ids=set(); self.links=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if 'id' in attrs:self.ids.add(attrs['id'])
        if tag=='a' and attrs.get('href','').startswith('#'):self.links.append(attrs['href'][1:])
c=Check();c.feed(page)
assert all(x in c.ids for x in c.links)
print(json.dumps({'path':str(output),'chapters':len(re.findall('<h2',body)),'tables':body.count('<table>'),'source_links':len(re.findall(r'href="https://',body)),'broken_anchors':0},ensure_ascii=False))
