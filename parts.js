// 오케스트라 악기 파트 (서버 검증 + 클라이언트 표시 공용)
const PARTS = [
  { id: 'vn1', label: '1바이올린', emoji: '🎻', color: '#c0392b', family: '현악' },
  { id: 'vn2', label: '2바이올린', emoji: '🎻', color: '#e67e22', family: '현악' },
  { id: 'va',  label: '비올라',   emoji: '🎻', color: '#d4a017', family: '현악' },
  { id: 'vc',  label: '첼로',     emoji: '🎻', color: '#27ae60', family: '현악' },
  { id: 'cb',  label: '베이스',   emoji: '🎻', color: '#16a085', family: '현악' },
  { id: 'ww',  label: '목관',     emoji: '🎶', color: '#2980b9', family: '관악' },
  { id: 'br',  label: '금관',     emoji: '🎺', color: '#8e44ad', family: '관악' },
  { id: 'pe',  label: '타악기',   emoji: '🥁', color: '#7f8c8d', family: '타악' },
  { id: 'co',  label: '지휘자',   emoji: '🎩', color: '#f1c40f', family: '지휘' },
];

const PART_IDS = new Set(PARTS.map(p => p.id));
const isValidPart = (id) => PART_IDS.has(id);
const getPart = (id) => PARTS.find(p => p.id === id) || null;

module.exports = { PARTS, isValidPart, getPart };
