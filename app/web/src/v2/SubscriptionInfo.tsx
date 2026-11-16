import type { Subscription } from './accounts';
export const chinaDateTime=(at:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
export const subscriptionLabel=(s:Subscription)=>s.status==='expired'?'已到期':s.status==='expiring'?`即将到期 · 剩余 ${s.daysRemaining} 天`:s.status==='lifetime'?'不限期':`使用中 · 剩余 ${s.daysRemaining} 天`;
export function SubscriptionInfo({value}:{value:Subscription}){
 return <div className={`subscription-info ${value.status}`}><div><span className="eyebrow">家庭使用期限</span><h2>{value.planName}</h2><p>{value.expiresAt===null?'当前家庭不限使用期限':`有效至 ${chinaDateTime(value.expiresAt)}（北京时间）`}</p></div><strong className="subscription-status">{subscriptionLabel(value)}</strong></div>;
}
