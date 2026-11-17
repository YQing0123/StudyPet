import {useState} from 'react';
import {accounts,type FamilySession} from './accounts';
import IslandIcon from './IslandIcon';
export default function AccountEntry({initial,onDone}:{initial:FamilySession;onDone:(s:FamilySession)=>void}){
 const code=new URLSearchParams(location.search).get('invite')||'';
 const [mode,setMode]=useState<'login'|'register'|'join'>(code?'join':'login');
 const [form,setForm]=useState({login:'',password:'',name:'',relation:'爸爸',familyName:'',childName:'',legacyPin:'',claimLegacy:!!initial.legacyAvailable,code,activationCode:''});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const field=(key:keyof typeof form,value:string|boolean)=>{setForm(f=>({...f,[key]:value}));setError('');};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{onDone(await (mode==='login'?accounts.login(form):mode==='register'?accounts.register(form):accounts.join(form)));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <main className="account-entry"><section className="account-welcome"><span className="account-wordmark"><IslandIcon name="island"/>伴学小岛</span><h1>一家人，<br/>陪着孩子慢慢长大。</h1><p>把每天的小计划，变成看得见的进步。<br/>爸爸妈妈一起安排、一起鼓励。</p><img src="/pets/breeds/dog_corgi_toon/frames/frame-sit.png" alt="卡通柯基学习伙伴"/><span className="account-welcome-note">认真一点点，陪伴多一点。</span></section>
 <section className="account-form-card"><div className="account-tabs" aria-label="账号入口">{([['login','登录'],['register','创建家庭'],['join','加入家庭']] as const).map(([key,label])=><button key={key} className={mode===key?'is-on':''} disabled={busy} onClick={()=>{setMode(key);setError('');}}>{label}</button>)}</div>
 <h2>{mode==='login'?'欢迎回到小岛':mode==='register'?'从你的家庭开始':'和家人一起陪伴'}</h2><p className="account-intro">{mode==='login'?'家长和学生都可以使用自己的账号登录。':mode==='register'?'使用管理员提供的开通码创建家庭，有效期从创建成功时开始计算。':'使用家人给你的成员邀请码加入已有家庭，共用该家庭有效期。'}</p>
 <form onSubmit={submit}>
 {mode!=='login'&&<div className="account-field-pair"><label>你的称呼<input autoComplete="nickname" required maxLength={20} value={form.name} onChange={e=>field('name',e.target.value)} placeholder="例如：小米爸爸"/></label><label>家庭身份<select value={form.relation} onChange={e=>field('relation',e.target.value)}>{['爸爸','妈妈','爷爷','奶奶','其他家长'].map(x=><option key={x}>{x}</option>)}</select></label></div>}
 <label>账号<input autoCapitalize="none" autoComplete="username" required minLength={3} maxLength={80} value={form.login} onChange={e=>field('login',e.target.value)} placeholder="字母、数字，也可以使用邮箱"/></label>
 <label>密码<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={mode==='login'?1:8} maxLength={128} value={form.password} onChange={e=>field('password',e.target.value)} placeholder={mode==='login'?'输入账号密码':'至少 8 个字符'}/></label>
 {mode==='join'&&<label>家庭邀请码<input required value={form.code} onChange={e=>field('code',e.target.value)} autoCapitalize="none" placeholder="粘贴家长提供的邀请码"/></label>}
 {mode==='register'&&<><label>家庭开通码<input required maxLength={100} autoCapitalize="characters" autoComplete="off" value={form.activationCode} onChange={e=>field('activationCode',e.target.value)} placeholder="管理员签发的 BX- 开通码"/></label><label>家庭名称<input required maxLength={40} value={form.familyName} onChange={e=>field('familyName',e.target.value)} placeholder="例如：小米的家"/></label>
 {initial.legacyAvailable?<div className="legacy-claim"><strong>保留本机已有记录</strong><p>原来的孩子、宠物、计划和星贝会关联到这个家庭。</p><label>原来的 4 位家长密码<input type="password" required inputMode="numeric" maxLength={4} value={form.legacyPin} onChange={e=>field('legacyPin',e.target.value)} autoComplete="off"/></label></div>:<label>第一个孩子的名字<input required maxLength={20} value={form.childName} onChange={e=>field('childName',e.target.value)} placeholder="以后也可以添加其他孩子"/></label>}</>}
 {error&&<p className="account-error" role="alert">{error}</p>}
 <button className="btn primary account-submit" disabled={busy} type="submit">{busy?'正在处理…':mode==='login'?'登录小岛':mode==='register'?'创建家庭并进入':'加入家庭'}</button>
 </form><p className="account-footnote">{mode==='login'?'学生忘记密码时，可由家庭中的家长重设。':'家庭中的每位家长都可以管理计划、审核任务和发放奖励。'}</p>
 </section></main>;
}
