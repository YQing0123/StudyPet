export const SPECIES_META = {
  cat: { species: '猫', trait: '爱晒太阳，也爱趴在你书桌边', line: '喵～今天也一起加油吧' },
  dog: { species: '狗', trait: '最会给你捧场，也最爱出门撒欢', line: '汪！完成计划就陪你玩球' },
  bird: { species: '鸟', trait: '话很多，喜欢在你读书时哼歌', line: '啾啾～今天读什么呀' },
  turtle: { species: '龟', trait: '慢吞吞，但会一直陪着你', line: '慢慢来，比较快' },
  capybara: { species: '卡皮巴拉', trait: '圆滚滚的淡定搭子，陪你慢慢把计划做完', line: '不着急，我陪你一点一点来' },
  alpaca: { species: '羊驼', trait: '安静又好奇，喜欢站在你身边看远方', line: '慢慢走，我陪你一起' },
};

export const BREED_LIST: [string, string, keyof typeof SPECIES_META, string][] = [
  ['cat_orange', '小橘猫', 'cat', '小橘'],
  ['cat_ragdoll', '布偶猫', 'cat', '布偶'],
  ['cat_black', '黑猫', 'cat', '煤球'],
  ['cat_blue', '蓝猫', 'cat', '蓝蓝'],
  ['dog_dairy', '奶狗', 'dog', '奶糖'],
  ['dog_golden', '金毛', 'dog', '金豆'],
  ['dog_corgi', '小柯基', 'dog', '豆包'],
  ['dog_corgi_toon', '卡通柯基', 'dog', '布丁'],
  ['capybara_toon', '卡皮巴拉', 'capybara', '卡卡'],
  ['alpaca_toon', '羊驼', 'alpaca', '阿驼'],
  ['dog_german', '德牧', 'dog', '阿牧'],
  ['bird_parakeet', '虎皮', 'bird', '啾啾'],
  ['bird_cockatiel', '玄凤', 'bird', '小玄'],
  ['bird_peachface', '牡丹', 'bird', '桃桃'],
  ['bird_pigeon', '信鸽', 'bird', '咕咕'],
  ['turtle_redear', '红耳龟', 'turtle', '慢慢'],
  ['turtle_grass', '草龟', 'turtle', '小草'],
  ['turtle_flower', '花龟', 'turtle', '花花'],
  ['turtle_map', '地图龟', 'turtle', '地图'],
];

export const PET_BREEDS = BREED_LIST.map(([id, name, species, defaultName]) => ({
  id, name, defaultName, speciesKey: species, species: SPECIES_META[species].species,
  avatar: `pets/avatars/${id}.png`,
  trait: SPECIES_META[species].trait,
  line: SPECIES_META[species].line,
}));

