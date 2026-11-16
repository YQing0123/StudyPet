export interface Subscription {
 expiresAt:number|null;planName:string;daysRemaining:number|null;status:'lifetime'|'active'|'expiring'|'expired';readOnly:boolean;serverTime:number;
}
export interface FamilySession {
 authenticated: boolean; legacyAvailable?: boolean;
 user?: {id:string;login:string;name:string}; role?: 'parent'|'student'; parentUnlocked?:boolean;
 family?: {id:string;name:string;role:string;relation:string;subscription:Subscription}; families?: {id:string;name:string;role:string;relation:string;subscription:Subscription}[];
 activeChildId?:string; children?: {id:string;name:string;grade:number;avatar:string}[];
 members?: {id:string;login:string;name:string;role:string;relation:string;childId:string|null}[];
 invitations?:{id:string;expiresAt:number;createdAt:string}[];
}
let scope:{familyId?:string;childId?:string}={};
export function setAccountScope(s:FamilySession){scope={familyId:s.family?.id,childId:s.activeChildId};}
export function scopeHeaders(){return {...(scope.familyId?{'x-family-id':scope.familyId}:{}),...(scope.childId?{'x-child-id':scope.childId}:{})};}
export async function accountRequest<T=FamilySession>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 let res:Response;
 try{res=await fetch(path,{method,headers:{'content-type':'application/json',...scopeHeaders()},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw Error('暂时连不上小岛，请检查连接后再试。');}
 const data=await res.json();if(!res.ok){if(res.status===402)window.dispatchEvent(new Event('island-subscription-expired'));if(res.status===401&&!['/api/auth/login','/api/auth/unlock','/api/auth/password'].includes(path))window.dispatchEvent(new Event('island-session-expired'));throw Error(data.error||'操作失败');}return data;
}
export const accounts={
 session:()=>accountRequest('/api/auth/session'),login:(body:unknown)=>accountRequest('/api/auth/login',body),register:(body:unknown)=>accountRequest('/api/auth/register',body),
 join:(body:unknown)=>accountRequest('/api/auth/join',body),joinSignedIn:(body:unknown)=>accountRequest('/api/family/join',body),
 logout:()=>accountRequest('/api/auth/logout',{}),lock:()=>accountRequest('/api/auth/lock',{}),unlock:(password:string)=>accountRequest('/api/auth/unlock',{password}),
 select:(familyId:string,childId?:string)=>accountRequest('/api/auth/context',{familyId,childId}),family:()=>accountRequest('/api/family'),
 addChild:(body:unknown)=>accountRequest('/api/family/children',body),editChild:(id:string,body:unknown)=>accountRequest(`/api/family/children/${id}`,body),
 studentAccount:(id:string,body:unknown)=>accountRequest(`/api/family/children/${id}/account`,body),
 invite:()=>accountRequest<{id:string;code:string;expiresAt:number}>('/api/family/invites',{}),revokeInvite:(id:string)=>accountRequest(`/api/family/invites/${id}`,{},'DELETE'),
 removeParent:(id:string)=>accountRequest(`/api/family/parents/${id}`,{},'DELETE'),password:(body:unknown)=>accountRequest<{ok:boolean}>('/api/auth/password',body),
 renew:(code:string)=>accountRequest('/api/family/renew',{code}),
};
