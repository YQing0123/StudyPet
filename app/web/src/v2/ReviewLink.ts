export type ReviewLink = { task: string; family: string; child: string };
export function readReviewLink(): ReviewLink | null {
 const q = new URLSearchParams(location.search);
 const task=q.get('review'),family=q.get('family'),child=q.get('child');
 return task&&family&&child ? {task,family,child} : null;
}
export function clearReviewLink() {
 const url=new URL(location.href);for(const key of ['review','family','child'])url.searchParams.delete(key);
 history.replaceState(null,'',url.pathname+url.search+url.hash);
}
