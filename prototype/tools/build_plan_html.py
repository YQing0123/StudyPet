import re, sys
from pathlib import Path
import markdown

root = Path(__file__).resolve().parents[2]
src = root / '方案/伴学小岛-完整落地方案.md'
out = root / '方案/伴学小岛-完整落地方案.html'
base = root / '方案/伴学小岛-完整方案.html'

text = src.read_text(encoding='utf-8')
md = markdown.Markdown(extensions=['extra', 'toc', 'sane_lists'],
                       extension_configs={'toc': {'toc_depth': '2-2'}})
body = md.convert(text)
body = re.sub(r'<h1[^>]*>.*?</h1>', '', body, count=1)
body = re.sub(r'<table>(.*?)</table>', r'<div class="table-wrap"><table>\1</table></div>', body, flags=re.S)

style = re.search(r'<style>(.*?)</style>', base.read_text(encoding='utf-8'), re.S)[1]
style += ('\narticle h4{font-size:18px;margin-top:28px}'
          'article h5{font-size:17px;color:#245c49;margin-top:24px}'
          'aside a{font-size:13px}table{font-size:13px}pre{font-size:12px}'
          'article p{overflow-wrap:anywhere}'
          'main{overflow-x:clip}.table-wrap{-webkit-overflow-scrolling:touch}'
          '@media(max-width:1080px){th,td{min-width:72px;padding:11px 12px}}'
          '@media(max-width:760px){table{min-width:0}th,td{min-width:64px;padding:10px 11px}}')

page = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<link rel="icon" href="data:,"><title>伴学小岛 · 完整落地方案</title>'
        '<style>' + style + '</style></head><body id="top">'
        '<aside id="nav"><div class="brand">伴学小岛</div>'
        '<div class="sub">完整落地方案 · v1.0</div>'
        '<div class="utility"><button onclick="window.print()">打印 / 存为PDF</button>'
        '<button class="mobile-nav" onclick="document.getElementById(\'nav\').classList.toggle(\'expanded\')">章节</button></div>'
        + md.toc + '</aside><main><header>'
        '<div class="eyebrow">产品 · 内容 · 美术 · 动效 · 工程</div>'
        '<h1>伴学小岛<br>完整落地方案</h1>'
        '<p>教材内容、学习证据与宠物生活共用一条可追溯链路，支持家庭自部署与持续更新。</p>'
        '</header><article>' + body + '</article>'
        '<footer>伴学小岛 · 完整落地方案</footer></main></body></html>')
out.write_text(page, encoding='utf-8')

ids = set(re.findall(r'id="([^"]+)"', page))
anchors = [a for a in re.findall(r'href="#([^"]+)"', md.toc)]
missing = [a for a in anchors if a not in ids]
print(f"章节 {len(anchors)}，缺失锚点 {len(missing)}")
print(f"输出 {out} ({len(page)} 字节)")
