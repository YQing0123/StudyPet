from pathlib import Path
import json,re,ast
base=Path(__file__).resolve().parent
catalog=json.loads((base/'catalog.json').read_text(encoding='utf-8'))
tables={x.get('schema','app')+'.'+x['name']:x for x in catalog['tables']}
errors=[]; warnings=[]; fk_count=0
for fqn,t in tables.items():
 cols={c['name']:c for c in t['columns']}
 if t['name'] not in ('families','accounts') and ('family_id' not in cols or cols['family_id']['nullable']):errors.append(f'{fqn}: mandatory family_id missing')
 if cols['id']['type']!='uuid' or cols['id'].get('default'):errors.append(f'{fqn}: UUID must be application-generated')
 for c in t['constraints']:
  m=re.match(r'FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)',c)
  if not m:continue
  fk_count+=1
  local=[x.strip() for x in m.group(1).split(',')]; target=m.group(2); remote=[x.strip() for x in m.group(3).split(',')]
  if len(local)!=len(remote):errors.append(f'{fqn}: FK arity mismatch {c}');continue
  if target not in tables:errors.append(f'{fqn}: missing referenced table {target}');continue
  tc=tables[target]; tcols={x['name']:x for x in tc['columns']}
  for lc,rc in zip(local,remote):
   if lc not in cols or rc not in tcols: errors.append(f'{fqn}: missing FK column {lc}->{target}.{rc}')
   elif cols[lc]['type']!=tcols[rc]['type']:errors.append(f'{fqn}: FK type mismatch {lc}->{target}.{rc}')
  normalized='('+', '.join(remote)+')'
  if not any(x in ('PRIMARY KEY '+normalized,'UNIQUE '+normalized) for x in tc['constraints']):errors.append(f'{fqn}: no exact target unique for {c}')
  if 'family_id' in cols and 'family_id' in tcols and ('family_id' not in local or remote[local.index('family_id')]!='family_id'):errors.append(f'{fqn}: cross-family FK not composite {c}')
 names=[c['name'] for c in t['columns']]
 if len(names)!=len(set(names)):errors.append(f'{fqn}: duplicate columns')
# Final integration contract: mandatory operational tables, public payload and API revision fields.
for required_name in ['family_settings','content_issues','ai_provider_configs','ai_budget_reservations','outbox_deliveries']:
 if 'app.'+required_name not in tables:errors.append('missing final integration table '+required_name)
for table_name in ['families','children','devices','curriculum_series']:
 revision_col=next((c for c in tables['app.'+table_name]['columns'] if c['name']=='revision'),None)
 if not revision_col or revision_col['type']!='bigint' or revision_col['nullable'] or revision_col.get('default')!='1':errors.append(table_name+' requires non-null bigint revision default 1')
 if 'CHECK (revision>0)' not in tables['app.'+table_name]['constraints']:errors.append(table_name+' revision positive constraint missing')
question_cols={c['name']:c for c in tables['app.question_versions']['columns']}
if question_cols.get('public_payload',{}).get('type')!='jsonb' or question_cols['public_payload']['nullable']:errors.append('public_payload must be non-null JSONB')
if question_cols.get('public_payload_schema_version',{}).get('type')!='integer':errors.append('public payload version missing')
if 'CHECK (jsonb_typeof(public_payload)=\'object\')' not in tables['app.question_versions']['constraints']:errors.append('public_payload object guard missing')
# Cross-contract compatibility: persisted question executor names must exactly match content contract.
contract_path=base.parent/'契约'/'内容'/'question-candidate.schema.json'
contract_types=[]
if contract_path.exists():
 contract=json.loads(contract_path.read_text(encoding='utf-8'))
 contract_types=contract['properties']['question_type']['enum']
 type_check=next(c for c in tables['app.question_versions']['constraints'] if c.startswith('CHECK (question_type IN ('))
 database_types=re.findall(r"'([^']+)'",type_check)
 if set(database_types)!=set(contract_types):errors.append('question_type CHECK differs from formal content contract')
 if len(database_types)!=len(set(database_types)):errors.append('duplicate database question_type value')
else:warnings.append('question-candidate schema absent; cross-contract enum check skipped')
for p in ['生成数据库设计.py','生成交付.py','校验数据库设计.py']:
 ast.parse((base/p).read_text(encoding='utf-8'))
sql=(base/'schema.sql').read_text(encoding='utf-8')
# Lexer, not an SQL parser. Validate quoting/comment/block balance and SQL statement boundaries.
i=0;state='normal';dollar=None;parens=0;statements=0
while i<len(sql):
 if state=='line':
  if sql[i]=='\n':state='normal'
  i+=1;continue
 if state=='block':
  if sql.startswith('*/',i):state='normal';i+=2
  else:i+=1
  continue
 if state=='quote':
  if sql.startswith("''",i):i+=2;continue
  if sql[i]=="'":state='normal'
  i+=1;continue
 if state=='dollar':
  if sql.startswith(dollar,i):state='normal';i+=len(dollar)
  else:i+=1
  continue
 if sql.startswith('--',i):state='line';i+=2;continue
 if sql.startswith('/*',i):state='block';i+=2;continue
 if sql[i]=="'":state='quote';i+=1;continue
 m=re.match(r'\$[A-Za-z_0-9]*\$',sql[i:])
 if m:dollar=m.group();state='dollar';i+=len(dollar);continue
 if sql[i]=='(':parens+=1
 if sql[i]==')':
  parens-=1
  if parens<0:errors.append('SQL closing parenthesis without opening')
 if sql[i]==';':statements+=1
 i+=1
if state not in ('normal','line'):errors.append('unclosed SQL lexical state '+state)
if parens:errors.append('SQL parenthesis imbalance '+str(parens))
if sql.count('CREATE TABLE ')!=len(tables):errors.append('SQL/catalog table count mismatch')
if not sql.rstrip().endswith('COMMIT;'):errors.append('SQL missing COMMIT')
if re.search(r'CREATE EXTENSION|gen_random_uuid\(|uuid_generate',sql,re.I):errors.append('external extension or DB UUID dependency')
if sql.count('FORCE ROW LEVEL SECURITY')!=len(tables):errors.append('RLS coverage count mismatch')
required=['reward_entitlements','inventory_ledger','question_answers','learning_evidence','slice_media_bindings','challenge_sessions']
for name in required:
 if not any(t['name']==name for t in tables.values()):errors.append('missing core table '+name)
# Trigger invocations must refer to a declared function.
funcs=set(re.findall(r'CREATE FUNCTION\s+([\w.]+)\(',sql))
for f in re.findall(r'EXECUTE FUNCTION\s+([\w.]+)\(',sql):
 if f not in funcs:errors.append('undefined trigger function '+f)
# PostgreSQL identifiers default max 63 bytes, all generated names here are ASCII.
for n in re.findall(r'(?:CONSTRAINT|INDEX|TRIGGER)\s+([a-zA-Z_][\w]*)',sql):
 if len(n.encode())>63:errors.append('identifier over 63 bytes '+n)
result={'validation':'static_only','postgres_executed':False,'postgres_parser_used':False,'table_count':len(tables),'mandatory_family_tables':len(tables)-2,'foreign_keys_checked':fk_count,'question_types_contract_checked':len(contract_types),'sql_statements_lexically_counted':statements,'trigger_functions':len(funcs),'errors':errors,'warnings':warnings,'limits':['No PostgreSQL16 server/client found on PATH.','No installed PostgreSQL AST parser was available.','Static validation checks model references/types/unique target keys, trigger references, tenant keys and lexical balance; it cannot prove PostgreSQL execution, PL/pgSQL runtime or concurrency correctness.']}
(base/'validation-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
if errors:raise SystemExit(1)
