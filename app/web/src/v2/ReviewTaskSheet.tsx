import {useCallback,useEffect,useRef,useState} from 'react';
import {Sheet} from '../mvp/Sheets';
import {v2} from './api';
import type {TaskV2} from './types';
import {taskPhotoSrc} from './StudentSheets';
const statusName={open:'尚未提交',submitted:'等待审核',approved:'已经通过',rejected:'已退回修改'};
export default function ReviewTaskSheet({id,onClose,onChanged,toast}:{id:string;onClose:()=>void;onChanged:()=>Promise<void>;toast:(m:string,tone?:string)=>void}){
 const [task,setTask]=useState<TaskV2|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reject,setReject]=useState(false),[reason,setReason]=useState(''),[fresh,setFresh]=useState(false),[expanded,setExpanded]=useState(false);
 const lock=useRef(false),request=useRef(0);
 const load=useCallback(async()=>{const n=++request.current;setLoading(true);setFresh(false);setError('');try{const data=await v2.reviewDetail(id);if(n===request.current){setTask(data);setFresh(true);}}catch(e:any){if(n===request.current){setTask(null);setError(e.message);}}finally{if(n===request.current)setLoading(false);}},[id]);
 useEffect(()=>{load();return()=>{request.current++;};},[load]);
 const review=async(approve:boolean)=>{
  if(!task||!fresh||lock.current)return;
  if(!approve&&!reason.trim()){setError('写一句退回原因，让孩子知道怎样修改。');return;}
  lock.current=true;setBusy(true);setError('');
  try{const updated=await v2.reviewTask(task.id,{approve,reason:reason.trim(),expectedSubmittedAt:task.submittedAt});setTask(updated);setReject(false);toast(approve?'审核通过，星贝已发放':'已退回，孩子可以查看原因并重新提交',approve?'gold':'');try{await onChanged();}catch{toast('审核已保存，家长端列表暂未刷新，请稍后重试。','warn');}}
  catch(e:any){setFresh(false);setError((e.message||'暂时无法确认审核结果')+'。请刷新最新状态后再操作。');}
  finally{lock.current=false;setBusy(false);}
 };
 return <Sheet open onClose={()=>{if(!busy)onClose();}} title="查看学习提交" sub="来自钉钉提醒 · 显示这项任务的最新状态，审核后才发放星贝。">
  {error&&<p className="settings-error" role="alert">{error}</p>}
  {loading?<p className="record-empty" role="status">正在读取提交内容…</p>:task?<article className="approve-card notify-review-card">
   <div className="approve-top"><span className="approve-icon">{task.icon}</span><div className="approve-title"><h3>{task.title}</h3><p>{task.subject} · {task.date} · {task.minutes} 分钟</p></div><span className="record-status">{statusName[task.status]}</span></div>
   <p className="notify-review-score">{task.status==='approved'?'已获得':'预计获得'} <b>{task.awardedPoints??task.basePoints}</b> 星贝<span>基础 {task.basePoints} · {task.timingLabel||'按任务规则计算'}</span></p>
   <p className="muted">孩子的一句话</p><p className="notify-review-note">{task.note||'这次没有填写留言。'}</p>
   {taskPhotoSrc(task)&&<button type="button" className={`notify-review-photo${expanded?' expanded':''}`} aria-label={expanded?'收起作业照片':'展开完整作业照片'} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><img src={taskPhotoSrc(task)} alt="孩子提交的作业照片" loading="lazy" decoding="async"/><span>{expanded?'点击收起照片':'点击展开照片'}</span></button>}
   {task.submittedAt&&<p className="muted">提交于 {new Date(task.submittedAt).toLocaleString('zh-CN',{hour12:false})}</p>}
   {task.rejectReason&&<p className="settings-error">退回原因：{task.rejectReason}</p>}
   {task.status==='submitted'?<>{reject&&<label className="notify-reject-label">退回原因<textarea className="text-input" maxLength={200} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：第二题再检查一下，改好后重新提交。"/></label>}<div className="settings-actions">
    <button className="btn ghost sm" disabled={busy} onClick={onClose}>稍后在家长端处理</button>
    <button className="btn ghost sm danger-text" disabled={busy||!fresh} onClick={()=>{if(reject)review(false);else setReject(true);}}>{reject?'确认退回':'退回修改'}</button>
    <button className="btn primary sm" disabled={busy||!fresh} onClick={()=>review(true)}>{busy?'处理中…':'同意并发放星贝'}</button>
   </div></>:<p className="pet-backup-hint">{task.status==='approved'?'这项任务已通过，无需重复审核。':task.status==='rejected'?'等待孩子修改后重新提交。':'孩子尚未提交这项任务。'}</p>}
  </article>:null}
  <div className="settings-actions"><button className="btn ghost sm" disabled={busy||loading} onClick={load}>刷新最新状态</button><button className="btn ghost sm" disabled={busy} onClick={onClose}>返回家长端</button></div>
 </Sheet>;
}
