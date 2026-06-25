// 오케스트라 후라이 도감 — 악기 파트 9 + 작곡가 12 = 21종
// 각 항목: id, name, group('악기'|'작곡가'), sub(분류 라벨), rarity, weight(가챠 가중치), desc, img(정적 SVG)
// rarity: common(흔함) / rare(레어) / epic(에픽) / legendary(전설)
const EGGS = [
  // ── 악기 파트 ──
  { id:'vn1', name:'제1바이올린 후라이', group:'악기', sub:'현악', rarity:'common', weight:16, desc:'선율을 이끄는 오케스트라의 얼굴, 제1바이올린.' },
  { id:'vn2', name:'제2바이올린 후라이', group:'악기', sub:'현악', rarity:'common', weight:16, desc:'화성을 받치며 든든히 따라가는 제2바이올린.' },
  { id:'va',  name:'비올라 후라이',     group:'악기', sub:'현악', rarity:'common', weight:16, desc:'현악의 중음을 메우는 따뜻한 비올라.' },
  { id:'vc',  name:'첼로 후라이',       group:'악기', sub:'현악', rarity:'rare',   weight:5,  desc:'깊고 노래하는 음색의 첼로.' },
  { id:'cb',  name:'콘트라베이스 후라이',group:'악기', sub:'현악', rarity:'rare',   weight:5,  desc:'가장 낮은 토대를 받치는 콘트라베이스.' },
  { id:'ww',  name:'목관 후라이',       group:'악기', sub:'관악', rarity:'rare',   weight:5,  desc:'매끄럽고 부드러운 목관(클라리넷·오보에 등).' },
  { id:'br',  name:'금관 후라이',       group:'악기', sub:'관악', rarity:'rare',   weight:5,  desc:'화려하고 웅장하게 울리는 금관.' },
  { id:'pe',  name:'타악기 후라이',     group:'악기', sub:'타악', rarity:'rare',   weight:5,  desc:'리듬의 심장을 두드리는 타악기.' },
  { id:'co',  name:'지휘자 후라이',     group:'악기', sub:'지휘', rarity:'epic',   weight:2,  desc:'전체를 하나로 모으는 마에스트로.' },

  // ── 작곡가 ──
  { id:'vivaldi',     name:'비발디 후라이',     group:'작곡가', sub:'이탈리아·바로크',   rarity:'rare',      weight:5, desc:'「사계」를 쓴 ‘붉은 머리 사제’.' },
  { id:'bach',        name:'바흐 후라이',       group:'작곡가', sub:'독일·바로크',       rarity:'epic',      weight:2, desc:'바로크 음악의 아버지.' },
  { id:'schubert',    name:'슈베르트 후라이',   group:'작곡가', sub:'오스트리아·낭만',   rarity:'epic',      weight:2, desc:'가곡의 왕, 「송어」·「겨울 나그네」.' },
  { id:'brahms',      name:'브람스 후라이',     group:'작곡가', sub:'독일·낭만',         rarity:'epic',      weight:2, desc:'교향곡 4곡과 「헝가리 무곡」.' },
  { id:'tchaikovsky', name:'차이콥스키 후라이', group:'작곡가', sub:'러시아·낭만',       rarity:'epic',      weight:2, desc:'「백조의 호수」·「호두까기인형」.' },
  { id:'dvorak',      name:'드보르작 후라이',   group:'작곡가', sub:'체코·낭만',         rarity:'epic',      weight:2, desc:'교향곡 「신세계로부터」.' },
  { id:'saintsaens',  name:'생상스 후라이',     group:'작곡가', sub:'프랑스·낭만',       rarity:'epic',      weight:2, desc:'「동물의 사육제」·「죽음의 무도」.' },
  { id:'mahler',      name:'말러 후라이',       group:'작곡가', sub:'오스트리아·후기낭만',rarity:'epic',     weight:2, desc:'거대한 교향곡의 건축가, 「부활」.' },
  { id:'rachmaninoff',name:'라흐마니노프 후라이',group:'작곡가', sub:'러시아·후기낭만',  rarity:'epic',      weight:2, desc:'피아노 협주곡 2번의 대가.' },
  { id:'mozart',      name:'모차르트 후라이',   group:'작곡가', sub:'오스트리아·고전',   rarity:'legendary', weight:1, desc:'천재 신동, 「마술피리」·「주피터」.' },
  { id:'beethoven',   name:'베토벤 후라이',     group:'작곡가', sub:'독일·고전→낭만',    rarity:'legendary', weight:1, desc:'「운명」·「합창」의 악성(樂聖).' },
  { id:'shostakovich',name:'쇼스타코비치 후라이',group:'작곡가', sub:'러시아·20세기',    rarity:'legendary', weight:1, desc:'교향곡 5번, 안경 너머의 풍자.' },
].map(e => ({ ...e, img: `eggs/${e.id}.svg` }));

const RARITY_META = {
  common:    { label: '흔함', color: '#7d8a99', stars: 1 },
  rare:      { label: '레어', color: '#2f8fd6', stars: 2 },
  epic:      { label: '에픽', color: '#9b51e0', stars: 3 },
  legendary: { label: '전설', color: '#f0a500', stars: 4 },
};

// 가중치 기반 랜덤 추첨 (서버)
function drawRandomEgg() {
  const total = EGGS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of EGGS) { r -= e.weight; if (r <= 0) return e; }
  return EGGS[0];
}

module.exports = { EGGS, RARITY_META, drawRandomEgg };
