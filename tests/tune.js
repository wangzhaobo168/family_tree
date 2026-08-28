/* 参数调优：扫描不同生育参数组合，输出总人数，用于挑选合适的示例规模 */
'use strict';
const FamilyData = require('../js/data.js');

const SEED = 20250520;
const combos = [
  // [probBase, probDecay, probMin, kidsExtraP, kidsThirdP, sonP]
  [0.87, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.88, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.89, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.90, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.91, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.92, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.93, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.94, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.95, 0.005, 0.65, 0.85, 0.18, 0.62],
  [0.90, 0.004, 0.70, 0.88, 0.20, 0.62],
  [0.93, 0.004, 0.75, 0.88, 0.20, 0.62],
  [0.94, 0.004, 0.75, 0.88, 0.20, 0.62],
];

for (const c of combos) {
  const [probBase, probDecay, probMin, kidsExtraP, kidsThirdP, sonP] = c;
  const data = FamilyData.generate(SEED, { probBase, probDecay, probMin, kidsExtraP, kidsThirdP, sonP });
  const s = data.stats;
  console.log(
    `[${c.join(',')}]  →  ${String(s.total).padStart(4)} 人 (男${s.male} 女${s.female})  ${s.maxGen} 世 在世${s.alive}`
  );
}
