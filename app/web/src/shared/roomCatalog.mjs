const scene = (key, name, icon, cost, desc, asset) => ({ key, name, icon, cost, desc, asset, kind: 'scene', effect: {} });
const furniture = (key, name, icon, cost, style, sprite, width) => ({ key, name, icon, cost, desc: `${style} · 永久收藏，可自由摆放与旋转`, style, sprite, width, asset: 'pets/room/furniture-atlas.webp', kind: 'furniture', effect: {} });
export const DEFAULT_ROOM_SCENE = 'scene_study';
export const ROOM_CATALOG = [
  scene('scene_study', '最初的小书房', '📚', 0, '熟悉的水彩书房，初始拥有', 'pets/scene/study.jpg'),
  scene('scene_sunroom', '阳光花房', '🌿', 120, '让花草和阳光住进小岛', 'pets/room/sunroom.webp'),
  scene('scene_seaside', '海风小屋', '🐚', 160, '窗外是海，屋里是自己的收藏', 'pets/room/seaside.webp'),
  scene('scene_woodland', '林间木屋', '🌲', 200, '在安静的森林里布置一个家', 'pets/room/woodland.webp'),
  furniture('f_monstera', '龟背竹盆栽', '🪴', 65, '自然原木', 0, 15),
  furniture('f_flower', '小花陶盆', '🌷', 45, '暖杏田园', 1, 12),
  furniture('f_lamp', '奶油落地灯', '💡', 95, '奶油简约', 2, 17),
  furniture('f_sofa', '鼠尾草双人沙发', '🛋️', 180, '奶油简约', 3, 28),
  furniture('f_armchair', '软杏小扶手椅', '🪑', 110, '暖杏田园', 4, 20),
  furniture('f_tv', '彩电与电视柜套组', '📺', 200, '自然原木', 5, 28),
  furniture('f_dining', '圆餐桌与双椅套组', '🍽️', 180, '自然原木', 6, 30),
  furniture('f_bookshelf', '小小藏书架', '📚', 130, '自然原木', 7, 20),
  furniture('f_rug', '编织椭圆地毯', '🧶', 70, '奶油简约', 8, 30),
  furniture('f_coffee', '原木小茶几', '☕', 80, '自然原木', 9, 18),
  furniture('f_bed', '软绵绵宠物床', '🛏️', 160, '奶油简约', 10, 24),
  furniture('f_fridge', '薄荷迷你冰箱', '🧊', 200, '奶油简约', 11, 18),
  furniture('f_air', '奶油空气净化器', '🌬️', 120, '奶油简约', 12, 13),
  furniture('f_radio', '复古木收音机', '📻', 90, '自然原木', 13, 13),
  furniture('f_ficus', '编织篮大榕树', '🌳', 145, '暖杏田园', 14, 22),
  furniture('f_drawers', '花瓶斗柜', '🗄️', 150, '暖杏田园', 15, 21),
];
export const ROOM_MAP = Object.fromEntries(ROOM_CATALOG.map(item => [item.key, item]));
export const isRoomItem = item => item?.kind === 'scene' || item?.kind === 'furniture';
