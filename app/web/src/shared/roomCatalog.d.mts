export interface RoomItem { key: string; name: string; icon: string; cost: number; desc: string; asset: string; nightAsset?: string; kind: 'scene' | 'furniture'; effect: Record<string, number | string>; style?: string; sprite?: number; width?: number; }
export const DEFAULT_ROOM_SCENE: string;
export const ROOM_CATALOG: RoomItem[];
export const ROOM_MAP: Record<string, RoomItem>;
export function isRoomItem(item: { kind: string } | undefined): boolean;
