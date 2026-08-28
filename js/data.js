/* ============================================================
 * 族谱示例数据生成器
 * 使用固定随机种子，每次生成一致的 24 世（代）示例族谱。
 * 姓氏、字辈诗、出生年代、分支概率均可在此调整。
 * ============================================================ */
(function (global) {
  'use strict';

  // ---------------- 可调参数 ----------------
  var SURNAME = '王';                 // 姓氏
  // 24 个字辈（对应 24 世）：“承先启后 德泽绵长 忠孝传家 诗书继世 光耀门楣 万代流芳”
  var POEM = '承先启后德泽绵长忠孝传家诗书继世光耀门楣万代流芳';
  var FOUNDER_YEAR = 1380;            // 始祖出生年（明洪武年间）
  var CURRENT_YEAR = 2025;
  var DEFAULT_SEED = 20250520;

  var SURNAME_POOL = '李王张刘陈杨黄赵吴周徐孙马朱胡郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';

  var MALE_GIVEN = '祥瑞福安康泰和顺明亮文武斌杰俊才学智勇毅强健宏伟志诚信义仁德礼贤良恭俭让增恒久兴旺荣华富贵昌盛隆泽润源基业功名高尚雅清廉正直刚毅朴实厚道谦逊端庄经纬经纶承业继宗怀远思源立本固根振兴昌隆永续';
  var FEMALE_GIVEN = '秀英美娟芳兰菊梅竹松柏桂莲荷萍蓉薇萱芷若欣怡悦佳好梦盼雪晴岚珍珠玉环翠青红紫彩霞云月星晨露霜雨虹雅静淑惠素洁贞婉婷媛';

  var NOTES = [
    '迁居泉州，经营茶行，家业日隆。',
    '少时习武，后从军，官至千总。',
    '设私塾授徒，乡里称善。',
    '精于医术，悬壶济世四十载。',
    '经营木作，手艺精湛，远近闻名。',
    '科考中举，赴任知县，清廉自守。',
    '出海经商，往来南洋，衣锦还乡。',
    '务农为本，勤耕不辍，子孙繁衍。',
    '举家迁往潮州，开基另立门户。',
    '幼承庭训，博闻强识，以教书为业。',
    '从商有道，乐善好施，修桥铺路。',
    '避乱迁居徽州，置业兴家。',
    '供职州府，掌管文书，颇受器重。',
    '弃武从文，考取秀才，设馆授徒。',
    '经营染坊，家资渐厚，广置田产。',
    '随族中长辈迁居台湾，垦荒定居。',
    '子承父业，扩建祖宅，香火绵延。',
    '研习堪舆，为族人择地营宅。',
    '早孤，由叔父抚养成人，奋发自立。',
    '精通算学，受聘为商号账房先生。'
  ];

  // mulberry32 伪随机数生成器（可复现）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate(seed, tune) {
    // 可调参数（默认值见下，可通过 tune 覆盖）
    var t = tune || {};
    var probBase = t.probBase != null ? t.probBase : 0.90;   // 非嫡系男丁生育概率基数
    var probDecay = t.probDecay != null ? t.probDecay : 0.004; // 随世代递减
    var probMin = t.probMin != null ? t.probMin : 0.70;      // 生育概率下限
    var kidsExtraP = t.kidsExtraP != null ? t.kidsExtraP : 0.88; // 生第 2 个孩子的概率
    var kidsThirdP = t.kidsThirdP != null ? t.kidsThirdP : 0.20; // 生第 3 个孩子的概率
    var sonP = t.sonP != null ? t.sonP : 0.62;                // 孩子为男孩的概率

    var rng = mulberry32(seed == null ? DEFAULT_SEED : seed);
    var persons = [];
    var byId = {};
    var nextId = 1;

    function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

    function makePerson(o) {
      var p = {
        id: nextId++,
        name: o.name,
        gender: o.gender,            // 'M' 男 / 'F' 女
        gen: o.gen,                  // 第几世（1 起）
        birthYear: o.birthYear,
        deathYear: o.deathYear,      // null 表示在世
        fatherId: o.fatherId || null,
        parent: o.parent || null,    // 直接父节点引用（布局与连线用）
        spouse: o.spouse || null,    // 男性：配偶显示文本（配 X氏 / 配 X名）
        marriedTo: o.marriedTo || null, // 女性：适 X
        note: o.note || '',
        isFounder: !!o.isFounder,
        isMainLine: !!o.isMainLine,  // 嫡长子一线，保证世代延续到第 24 世
        children: [],
        collapsed: false,
        visible: true,
        x: 0,
        y: 0
      };
      p.isAlive = p.deathYear == null && p.birthYear != null;
      persons.push(p);
      byId[p.id] = p;
      return p;
    }

    // ---------- 始祖 ----------
    var root = makePerson({
      name: SURNAME + POEM.charAt(0) + pick(MALE_GIVEN),
      gender: 'M', gen: 1,
      birthYear: FOUNDER_YEAR,
      deathYear: FOUNDER_YEAR + 46 + Math.floor(rng() * 28),
      isFounder: true, isMainLine: true,
      spouse: '配 ' + pick(SURNAME_POOL) + '氏',
      note: '始迁祖，明初自江西吉安迁居闽南，披荆斩棘，开基立业，后世子孙繁衍昌盛。'
    });

    // ---------- 繁衍 ----------
    function createChildren(p) {
      if (p.gender !== 'M') return;
      if (p.gen >= POEM.length) return; // 末代不再生育

      var nKids;
      if (p.isMainLine) {
        nKids = 1 + (rng() < 0.78 ? 1 : 0) + (rng() < 0.18 ? 1 : 0);
      } else {
        var prob = Math.max(probMin, probBase - p.gen * probDecay);
        if (rng() > prob) return;      // 该支无后
        nKids = 1 + (rng() < kidsExtraP ? 1 : 0) + (rng() < kidsThirdP ? 1 : 0);
      }

      var kids = [];
      for (var i = 0; i < nKids; i++) {
        var isSon = (p.isMainLine && i === 0) ? true : (rng() < sonP);
        var by = p.birthYear + 21 + Math.floor(rng() * 9); // 生育间隔约 21–29 年
        var childGen = p.gen + 1;

        if (isSon) {
          var death = by + 42 + Math.floor(rng() * 44);
          var c = makePerson({
            name: SURNAME + POEM.charAt(p.gen) + pick(MALE_GIVEN),
            gender: 'M', gen: childGen, birthYear: by,
            deathYear: (by + 96 > CURRENT_YEAR) ? null : Math.min(death, CURRENT_YEAR - 5),
            fatherId: p.id, parent: p,
            isMainLine: p.isMainLine && i === 0,
            note: rng() < 0.14 ? pick(NOTES) : ''
          });
          if (rng() < 0.9) {
            c.spouse = (childGen <= 8)
              ? '配 ' + pick(SURNAME_POOL) + '氏'
              : '配 ' + pick(SURNAME_POOL) + pick(FEMALE_GIVEN);
          }
          kids.push(c);
        } else {
          var dDeath = by + 48 + Math.floor(rng() * 42);
          var d = makePerson({
            name: SURNAME + pick(FEMALE_GIVEN) + (rng() < 0.6 ? pick(FEMALE_GIVEN) : ''),
            gender: 'F', gen: childGen, birthYear: by,
            deathYear: (by + 100 > CURRENT_YEAR) ? null : Math.min(dDeath, CURRENT_YEAR - 5),
            fatherId: p.id, parent: p,
            marriedTo: '适 ' + pick(SURNAME_POOL) + (childGen <= 8 ? '氏' : pick(MALE_GIVEN) + pick(MALE_GIVEN)),
            note: rng() < 0.1 ? pick(NOTES) : ''
          });
          kids.push(d);
        }
      }
      p.children = kids;
    }

    // 广度优先生成整树
    var queue = [root];
    while (queue.length) {
      var cur = queue.shift();
      createChildren(cur);
      for (var k = 0; k < cur.children.length; k++) queue.push(cur.children[k]);
    }

    // ---------- 统计 ----------
    var maxGen = 0, maleCount = 0, femaleCount = 0, aliveCount = 0;
    persons.forEach(function (p) {
      if (p.gen > maxGen) maxGen = p.gen;
      if (p.gender === 'M') maleCount++; else femaleCount++;
      if (p.deathYear == null) aliveCount++;
    });

    return {
      surname: SURNAME,
      poem: POEM,
      seed: seed == null ? DEFAULT_SEED : seed,
      root: root,
      persons: persons,
      byId: byId,
      stats: {
        total: persons.length,
        maxGen: maxGen,
        male: maleCount,
        female: femaleCount,
        alive: aliveCount
      }
    };
  }

  var api = { generate: generate, SURNAME: SURNAME, POEM: POEM };
  global.FamilyData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
