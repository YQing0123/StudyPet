import './island-icons.css';

const icons = ['island','plan','travel','challenge','materials','wish','bag','parent','logout','food','play','pet','hug','shower','sleep','star'] as const;
export type IslandIconName = typeof icons[number];

/** Shared transparent sprite sheet; each icon keeps its own colors on any surface. */
export default function IslandIcon({name,className=''}:{name:IslandIconName;className?:string}) {
  const index = icons.indexOf(name);
  return <span aria-hidden="true" className={`island-icon ${className}`} style={{backgroundPosition:`${index%4/3*100}% ${Math.floor(index/4)/3*100}%`}}/>;
}
