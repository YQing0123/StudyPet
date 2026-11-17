import { req } from './api';
export type Subject = 'poetry' | 'math';
export type Policy = { grade:number;term:'upper'|'lower';textbook:string;mathScope:string;topics:string[];poemIds:string[];nextGrade:boolean;dailyRounds:number;questionsPerRound:number;roundMinutes:number;dailyPoints:null;doubleEnabled:boolean };
export type Question = { id:string;subject:Subject;type:'choice'|'number';prompt:string;cue?:string;title:string;source:string;options?:string[];seconds:number;review?:boolean;answer?:string;explanation?:string };
export type WrongSummary = {state:'pending'|'mastered';wrongCount:number;relapseCount:number};
export type Round = {id:string;subject:Subject;difficulty:number;mode:'standard'|'double';status:string;index:number;total:number;correct:number;reward:number;rewardCap:number;rulesVersion:number;pending:number;nextReward:number|null;canCashOut:boolean;serverNow:number;expiresAt:number;deadline:number|null;question:Question|null;balance:number;feedback:{correct:boolean;timedOut:boolean;response:string|null;answer:string;explanation:string;wrong:WrongSummary|null}|null};
export type Lobby = {policy:Policy;usage:{rounds:number;remainingRounds:number;seconds:number;earned:number};rewards:Record<string,number[]>;available:Record<Subject,number[]>;active:Round|null;wrong:{total:number;pending:number;relapse:number};recent:Round[]};
export type Settings = {policy:Policy;topics:{id:string;name:string}[];poems:{id:string;title:string;grade:number;group:string;source:string}[];sourceName:string};
export type WrongPage = {total:number;offset:number;limit:number;next:number|null;summary:{total:number;pending:number;mastered:number;relapse:number};items:{question:Question;state:'pending'|'mastered';wrongCount:number;correctCount:number;relapseCount:number;firstWrongAt:string;lastWrongAt:string;masteredAt:string|null}[]};
const post = <T,>(path:string, body:unknown={}) => req<T>('/api/v2/challenges'+path,{method:'POST',body:JSON.stringify(body)});
export const challengeApi = {
 lobby:()=>req<Lobby>('/api/v2/challenges'),
 settings:()=>req<Settings>('/api/v2/challenges/settings'),
 save:(p:Policy)=>post<Settings>('/settings',p),
 start:(subject:Subject,difficulty:number,mode:'standard'|'double',requestId:string)=>post<Round>('/rounds',{subject,difficulty,mode,requestId}),
 round:(id:string)=>req<Round>('/api/v2/challenges/rounds/'+id),
 next:(id:string,index:number,confirmContinue=false)=>post<Round>(`/rounds/${id}/next`,{index,confirmContinue}),
 answer:(id:string,index:number,response:string|null)=>post<Round>(`/rounds/${id}/answer`,{index,response}),
 abandon:(id:string)=>post<Round>(`/rounds/${id}/abandon`),
 cashout:(id:string)=>post<Round>(`/rounds/${id}/cashout`),
 wrong:(params:URLSearchParams)=>req<WrongPage>('/api/v2/challenges/wrong?'+params),
};
export const subjectName = (s:Subject) => s==='poetry'?'古诗词挑战':'计算题挑战';
export const subjectLabel = (s:Subject) => s==='poetry'?'古诗词':'数学计算';
export const levelName = (n:number) => ['','普通','挑战','困难'][n];

export const modeName = (mode: 'standard'|'double') => mode === 'double' ? '翻倍挑战' : '普通挑战';
export const challengeDescription = (r: Pick<Round,'mode'|'subject'|'difficulty'>) => `玩法：${modeName(r.mode)} · 学科：${subjectLabel(r.subject)} · 难度：${levelName(r.difficulty)}`;
