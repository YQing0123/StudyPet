from pathlib import Path
import base64
import html
import json
import re
import markdown
from html.parser import HTMLParser

root = Path('/Users/yqing/Documents/Project/学习打卡养宠物')
source = root / '方案/伴学小岛-产品与技术设计方案.md'
text = source.read_text(encoding='utf-8')
image = root / 'dsh-image-gen/image-05af7493.png'
image_uri = 'data:image/png;base64,' + base64.b64encode(image.read_bytes()).decode('ascii')
text = text.replace('../dsh-image-gen/image-05af7493.png', image_uri)
renderer = markdown.Markdown(extensions=['extra', 'toc', 'sane_lists'], extension_configs={'toc': {'toc_depth': '2-2', 'permalink': False}})
body = renderer.convert(text)
body = re.sub(r'<h1[^>]*>.*?</h1>', '', body, count=1)
body = re.sub(r'<table>(.*?)</table>', r'<div class="table-wrap"><table>\1</table></div>', body, flags=re.S)
flow_nodes = [
    ('客户端', 'iPad 孩子端 · 家长 Web · TV 与录音伴侣'),
    ('接入与权限', 'HTTPS · 设备认证 · 家庭与角色范围'),
    ('学习核心', '教材原文库 → 计划范围 → 训练验证 → 证据与复习'),
    ('宠物核心', '奖励事务与账本 → 食物背包 → 身体状态 → 场景与对白'),
    ('存储与扩展', 'PostgreSQL · NAS 媒体目录 · 可关闭的 AI / 语音适配器')
]
architecture = '<div class="architecture" role="img" aria-label="应用模块关系：客户端通过HTTPS访问学习和宠物服务，服务端负责奖励账本与存储">'
for idx, (label, desc) in enumerate(flow_nodes):
    architecture += '<div class="arch-line"><b>' + html.escape(label) + '</b><span>' + html.escape(desc) + '</span></div>'
    if idx < len(flow_nodes)-1:
        architecture += '<div class="connector" aria-hidden="true"></div>'
architecture += '</div>'
body = re.sub(r'<pre><code class="language-mermaid">.*?</code></pre>', architecture, body, flags=re.S)
style = '''
:root{color-scheme:light;--paper:#fffaf1;--ink:#363e35;--muted:#667065;--green:#245c49;--line:#dbe2d6;--soft:#ecf1e6}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:var(--green);text-underline-offset:4px}a:focus-visible,button:focus-visible{outline:3px solid #b56c26;outline-offset:4px}aside{position:fixed;inset:0 auto 0 0;width:270px;background:#edf2e8;padding:34px 25px;overflow:auto;border-right:1px solid var(--line)}.brand{font-size:25px;font-weight:750;color:var(--green);letter-spacing:1px}.sub{font-size:13px;color:var(--muted);margin:7px 0 24px}aside ul{padding:0;list-style:none}aside li{margin:7px 0}aside a{font-size:14px;text-decoration:none;display:block;border-radius:7px;padding:5px 8px}aside a:hover{background:#dce8d7}.utility{display:flex;gap:8px;margin-top:24px}.utility button{border:1px solid #aabda9;border-radius:8px;background:transparent;color:var(--green);padding:9px 16px;cursor:pointer;font:inherit;font-size:13px}main{margin-left:270px;max-width:1330px;padding:58px 64px 90px}header{padding:0 0 35px;border-bottom:1px solid var(--line);margin-bottom:36px}.eyebrow{color:var(--green);font-weight:650;font-size:14px;letter-spacing:2px}header h1{font-size:46px;line-height:1.25;color:var(--green);letter-spacing:-1.5px;margin:12px 0 15px}header p{max-width:690px;font-size:18px;color:var(--muted);margin:0}.core-flow{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.core-flow span{font-size:13px;border-bottom:2px solid #acc9a8;padding:5px 2px}.lead-image{width:100%;height:auto;display:block;border-radius:14px;margin:28px 0 9px}.caption{font-size:13px;color:var(--muted)}article h2{font-size:27px;line-height:1.5;color:var(--green);margin:60px 0 22px;padding-top:8px;letter-spacing:-.4px}article h3{font-size:20px;line-height:1.6;margin:33px 0 13px}article p{margin:12px 0 18px;overflow-wrap:anywhere}article li{margin:8px 0}article ul,article ol{padding-left:24px}.table-wrap{overflow:auto;max-width:100%;margin:22px 0;border:1px solid var(--line);border-radius:9px}table{border-collapse:collapse;width:100%;font-size:14px;min-width:590px}th{text-align:left;background:#e9f0e4;font-weight:650;color:#244b3b}th,td{padding:13px 15px;vertical-align:top;border-bottom:1px solid var(--line);line-height:1.7;min-width:95px}tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fffef9}pre{max-width:100%;overflow:auto;background:#1f332b;color:#eff6e8;border-radius:9px;padding:24px;font-size:13px;line-height:1.7}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}article img{width:100%;height:auto;border-radius:12px}blockquote{margin:22px 0;border-left:4px solid #b0c9a7;padding:4px 20px;color:var(--muted)}.architecture{border:1px solid var(--line);border-radius:12px;padding:25px;margin:20px 0;background:#f2f5eb}.arch-line{display:flex;gap:24px;align-items:center;background:#fffdf7;border:1px solid #d5e0cd;border-radius:8px;padding:15px 18px}.arch-line b{min-width:100px;color:var(--green);font-size:15px}.arch-line span{font-size:14px}.connector{height:20px;width:2px;background:#9fb791;margin-left:67px}footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.mobile-nav{display:none}#top-link{display:block;margin-top:20px}
@media(min-width:1550px){main{margin-left:300px;padding-left:90px;padding-right:90px}aside{width:300px}}@media(max-width:1080px){aside{width:230px;padding:28px 16px}main{margin-left:230px;padding:40px 30px 70px}header h1{font-size:37px}article h2{font-size:24px}}@media(max-width:760px){aside{position:static;width:auto;padding:22px 23px;max-height:none;border-right:0;border-bottom:1px solid var(--line)}aside .toc{display:none}aside.expanded .toc{display:block}aside .sub{margin-bottom:0}.utility{margin-top:15px}.mobile-nav{display:block}main{margin:0;padding:32px 22px 60px}header h1{font-size:32px;letter-spacing:-.5px}header p{font-size:16px}article h2{font-size:23px;margin-top:43px}article h3{font-size:19px}.arch-line{display:block}.arch-line b{display:block;margin-bottom:5px}body{font-size:16px}pre{padding:16px}article li{margin:10px 0}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{aside,.utility,.core-flow{display:none!important}main{margin:0;max-width:none;padding:0}body{background:white;color:#222;font-size:10pt;line-height:1.65}header h1{font-size:28pt}header{margin-bottom:20px}article h2{font-size:18pt;page-break-after:avoid;margin-top:28px}article h3{font-size:13pt;page-break-after:avoid}table{min-width:0;font-size:8pt}th,td{padding:7px;min-width:0}tr{break-inside:avoid}.table-wrap{overflow:visible}pre{white-space:pre-wrap;background:#eee;color:#222;font-size:8pt}a{color:#222;text-decoration:none}img{break-inside:avoid}.arch-line{break-inside:avoid}}
'''
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link rel="icon" href="data:,"><title>伴学小岛 · 产品与技术设计方案</title><style>''' + style + '''</style></head><body id="top"><aside id="nav"><div class="brand">伴学小岛</div><div class="sub">英语学习 · 宠物陪伴 · 家庭计划</div><div class="utility"><button type="button" onclick="window.print()">打印 / 存为 PDF</button><button type="button" class="mobile-nav" onclick="document.getElementById('nav').classList.toggle('expanded');this.setAttribute('aria-expanded',document.getElementById('nav').classList.contains('expanded'))" aria-expanded="false">章节</button></div>''' + renderer.toc + '''<a href="#top" id="top-link">返回顶部</a></aside><main><header><div class="eyebrow">产品与技术设计方案</div><h1>学习有约定，<br>陪伴有回应。</h1><p>相同教材内容，连接每周计划、训练验证与宠物生活。让孩子愿意主动开始，也能安心求助和休息。</p><div class="core-flow"><span>教材内容库</span><span>每周每日范围</span><span>原工具学习</span><span>应用训练验证</span><span>奖励与照顾</span></div></header><article>''' + body + '''</article><footer>伴学小岛 · 产品与技术设计方案</footer></main></body></html>'''
out = root / '方案/伴学小岛-完整方案.html'
out.write_text(page, encoding='utf-8')

class Check(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=set(); self.links=[]; self.images=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.add(attrs['id'])
        if tag=='a' and attrs.get('href','').startswith('#'): self.links.append(attrs['href'][1:])
        if tag=='img': self.images.append(attrs.get('src',''))
check=Check(); check.feed(page)
assert all(link in check.ids for link in check.links), '目录锚点有缺失'
assert all(src.startswith('data:image/') for src in check.images), '图片未内嵌'
json_examples=re.findall(r'```json\n(.*?)\n```',source.read_text(encoding='utf-8'),flags=re.S)
for example in json_examples: json.loads(example)
print(json.dumps({'html':str(out),'markdown_characters':len(text)-len(image_uri),'toc_links':len(check.links),'inline_images':len(check.images),'json_examples_valid':len(json_examples),'html_bytes':out.stat().st_size},ensure_ascii=False))
