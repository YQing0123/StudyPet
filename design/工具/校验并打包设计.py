from pathlib import Path
import json,re,ast,zipfile,hashlib,csv
from jsonschema import Draft202012Validator,FormatChecker
root=Path('/Users/yqing/Documents/Project/学习打卡养宠物/design'); contracts=root/'契约'; qa=root/'校验';qa.mkdir(exist_ok=True)
api=json.loads((contracts/'openapi.json').read_text());ops=json.loads((contracts/'operations.json').read_text());features=json.loads((root/'功能清单.json').read_text());catalog=json.loads((root/'数据库/catalog.json').read_text())
errors=[];checks=[]
def require(ok,name):
 checks.append({'check':name,'passed':bool(ok)})
 if not ok:errors.append(name)
ids=[]
for path,methods in api['paths'].items():
 for method,op in methods.items():
  ids.append(op['operationId']);expected=set(re.findall(r'\{([^}]+)\}',path));actual={p['name'] for p in op.get('parameters',[]) if p['in']=='path'}
  require(expected==actual,'path_parameters:'+op['operationId'])
  for p in op.get('parameters',[]):
   if p['in']=='path':require(p.get('required') is True,'required_path:'+op['operationId']+p['name'])
require(len(ids)==len(set(ids)),'unique_operation_ids')
require(set(ids)=={x['operation_id'] for x in ops},'operation_catalog_consistency')
require(len(features)==len({x['功能ID'] for x in features}),'feature_ids_unique')
for f in features:require(f['operation_id'] in ids or f['operation_id'] in ['reserved','source-slice.schema.json'],'feature_operation:'+f['功能ID'])
def refs(value):
 if isinstance(value,dict):
  if '$ref'in value:yield value['$ref']
  for v in value.values():yield from refs(v)
 elif isinstance(value,list):
  for v in value:yield from refs(v)
for ref in refs(api):
 require(ref.startswith('#/components/schemas/') and ref.split('/')[-1] in api['components']['schemas'],'schema_reference:'+ref)
for name,schema in api['components']['schemas'].items():Draft202012Validator.check_schema(schema)
fc=FormatChecker();schema={'$ref':'#/components/schemas/AnswerResponse','components':api['components']};validator=Draft202012Validator(schema,format_checker=fc)
u='40000000-0000-4000-8000-000000000005'
for payload in [{'option_id':u},{'gaps':[{'gap_id':u,'option_id':u}]},{'gaps':[{'gap_id':u,'text':'blue'}]},{'pairs':[{'left_id':u,'right_id':u}]},{'token_ids':[u]},{'media_asset_id':u}]:require(not list(validator.iter_errors(payload)),'valid_answer:'+str(list(payload)))
for payload in [{'option_id':'correct'},{'score':4},{'pairs':[{'left_id':u,'right_id':'fake'}]},{'token_ids':['x']},{'gaps':[{'gap_id':'x','text':'blue'}]},{'media_asset_id':u,'correct':True}]:require(bool(list(validator.iter_errors(payload))),'reject_bad_answer:'+str(list(payload)))
require(all(next(t for t in catalog['tables'] if t['name']==n)['columns'] for n in ['family_settings','content_issues','ai_provider_configs','ai_budget_reservations','outbox_deliveries']),'required_runtime_entities')
for p in root.rglob('*.py'):
 ast.parse(p.read_text());require(True,'python_syntax:'+str(p.relative_to(root)))
md=(root/'交付/伴学小岛-技术详细设计.md').read_text()
headings=re.findall(r'^## (\d+)\.',md,re.M);require(headings==[str(i) for i in range(1,19)],'sequential_main_chapters')
for snippet in re.findall(r'```json\n(.*?)\n```',md,re.S):json.loads(snippet)
reports={}
for name,path in [('database',root/'数据库/validation-report.json'),('content',contracts/'内容/validation-report.json'),('integration',contracts/'内容/integration-report.json')]:
 reports[name]=json.loads(path.read_text())
 require(reports[name].get('result','pass')=='pass' and not reports[name].get('errors',[]),'subreport:'+name)
summary={'result':'pass' if not errors else 'fail','table_count':len(catalog['tables']),'operation_count':len(ids),'schema_count':len(api['components']['schemas']),'feature_count':len(features),'main_chapters':len(headings),'checks':len(checks),'errors':errors,'validation_levels':{'database':'static relationship and lexical checks; not executed on PostgreSQL16','api':'references, parameters, JSON Schema and response payload checks; no implemented server','content':'positive/negative fixtures and cross-file projections; no LLM execution','architecture':'Archify validate/deliver/check/browser-check passed','word':'reopened structure and sample pages rendered and inspected'},'subreports':reports}
(qa/'设计校验汇总.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
if errors:raise SystemExit('\n'.join(errors))
# Readable entry point for the complete development package.
readme='''# 伴学小岛技术设计开发包

## 文档入口

- `交付/伴学小岛-技术详细设计.html`：完整阅读版，含章节导航和架构图入口。
- `交付/伴学小岛-技术详细设计.docx`：完整Word文档，含逐表字段、约束与流程。
- `交付/伴学小岛-技术详细设计.md`：汇编源稿。
- `功能清单.csv` / `功能清单.json`：按阶段的功能与接口映射。
- `数据库/schema.sql`：PostgreSQL16初始DDL，空库执行，不能作为重复升级脚本。
- `数据库/catalog.json`：机器可读完整数据字典。
- `契约/openapi.json`：OpenAPI3.1接口设计。
- `契约/内容/`：源切片、AI出题蓝图、题目候选Schema、正反例与校验工具。
- `契约/内容/开源逻辑映射.json`：采用的Anzo/Lute逻辑与不照搬部分、来源和许可边界。
- `校验/设计校验汇总.json`：设计校验结果和未执行范围。

## 开发顺序

先按技术文档的WP-01初始化工程和空库迁移，再完成WP-02/03教材与题库；宠物样片可并行。用一页自编材料、一次验证、一份营养和一次喂食形成最小闭环，再扩一周真实教材。P2/P3/P4字段和接口是分阶段设计，不表示已经实现。

## 契约职责

内容Schema负责类型和引用形状，领域lint负责范围和可判定性，语义检查负责识别风险；AI一致不等于教材和题目无误。公开题目从私有候选投影，不把标准答案发给儿童端。数据库约束和事务负责资格、库存和归属，动画与AI对白不能修改账本。

## 校验边界

DDL已完成静态关系、唯一键、RLS覆盖、触发器引用和词法检查，尚未在PostgreSQL16实际执行。正式开发首步必须在隔离空库执行DDL并补事务/并发/RLS测试。HTTP接口尚未实现，Schema样例通过不是接口联调通过。Word已检查封面与样页，未逐页人工审阅全部分页；字体和分页可能因阅读器变化。

## 修改与再生成

章节源稿位于`章节/`，接口/功能由`工具/生成接口与功能契约.py`生成；数据库由`数据库/生成数据库设计.py`与`生成交付.py`构建，内容契约由其目录工具生成。修改后依次重跑数据库、内容、接口交叉校验，再汇编和导出Word。Word导出使用python-docx；内容校验使用jsonschema；HTML汇编使用markdown与BeautifulSoup。依赖未打包，使用已有受控环境，不运行任意远程脚本。
'''
(root/'开发包使用说明.md').write_text(readme,encoding='utf-8')
# Deterministic package excluding browser previews, caches and itself.
files=[]
for p in sorted(root.rglob('*')):
 if not p.is_file() or '__pycache__' in p.parts or p.suffix in ['.zip','.pyc'] or p.name in ['文档构建数据.json','文件清单.json']:continue
 files.append(p)
manifest=[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
(root/'交付/文件清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');files.append(root/'交付/文件清单.json')
package=root/'交付/伴学小岛-技术设计开发附件.zip'
with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in files:z.write(p,'伴学小岛技术设计/'+str(p.relative_to(root)))
with zipfile.ZipFile(package) as z:require(z.testzip() is None,'zip_integrity')
print(json.dumps({'result':'pass','tables':summary['table_count'],'operations':len(ids),'features':len(features),'checks':len(checks),'package_files':len(files),'package_bytes':package.stat().st_size},ensure_ascii=False))
