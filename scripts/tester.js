// 써 보기 — 서체 파일을 읽어 조절판을 만든다. 서체 페이지마다 다시 쓴다.
//   <section class="tester" data-font="서체 파일"> 안의 견본 문장 단추(data-sample)는 페이지가 정하고,
//   '모든 글자'와 오픈타입 기능 단추는 서체 파일에서 저절로 생긴다 — 만든 글자, 든 기능만.

// 서체 파일의 표 자리 { cmap: 오프셋, GSUB: …, … }
function fontTables(v) {
  const t = {};
  for (let i = 0; i < v.getUint16(4); i++) {
    const p = 12 + i * 16;
    t[String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3))] = v.getUint32(p + 8);
  }
  return t;
}

// cmap 표 → 들어 있는 글자(코드포인트) 모음. 위키 테스터의 fontChars에서 가져왔다
function fontChars(v, t) {
  const set = new Set();
  const cmap = t.cmap;
  if (cmap === undefined) return set;
  for (let i = 0; i < v.getUint16(cmap + 2); i++) {
    const off = cmap + v.getUint32(cmap + 4 + i * 8 + 4);
    const fmt = v.getUint16(off);
    if (fmt === 4) {
      const seg = v.getUint16(off + 6) / 2;
      const ends = off + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let s = 0; s < seg; s++) {
        const start = v.getUint16(starts + s * 2), end = v.getUint16(ends + s * 2);
        const delta = v.getInt16(deltas + s * 2), ro = v.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          const g = ro ? v.getUint16(ranges + s * 2 + ro + (c - start) * 2) : c;
          if (g && ((g + delta) & 0xFFFF)) set.add(c);
        }
      }
    } else if (fmt === 12) {
      for (let k = 0; k < v.getUint32(off + 12); k++) {
        const p = off + 16 + k * 12;
        for (let c = v.getUint32(p); c <= v.getUint32(p + 4); c++) set.add(c);
      }
    }
  }
  return set;
}

// GSUB·GPOS 표의 기능 목록 → 기능 이름(네 글자) 모음
function fontFeatures(v, t) {
  const set = new Set();
  for (const tag of ['GSUB', 'GPOS']) {
    if (t[tag] === undefined) continue;
    const list = t[tag] + v.getUint16(t[tag] + 6);
    for (let i = 0; i < v.getUint16(list); i++) {
      const p = list + 2 + i * 6;
      set.add(String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3)));
    }
  }
  return set;
}

// 단추를 만드는 기능과 이름. 여기 없는 기능(ccmp·locl·mark 같은 속 기능)은 단추를 안 만든다.
// 스타일 세트(ss01–ss20)는 이름을 지어 붙인다
const FEATURES = {
  kern: '커닝', liga: '합자', dlig: '자유 합자', calt: '문맥 대체', salt: '대체 글자', swsh: '꼬리 글자',
  lnum: '높이 맞춘 숫자', onum: '옛 숫자', tnum: '고정폭 숫자', pnum: '비례 숫자', zero: '빗금 0', frac: '분수',
  sups: '위 첨자', subs: '아래 첨자', case: '대문자용 부호', smcp: '작은 대문자',
};
const ON_AT_START = new Set(['kern', 'liga', 'calt']);   // 브라우저가 처음부터 켜 두는 것
const featureName = (tag) => FEATURES[tag] || (/^ss\d\d$/.test(tag) ? '스타일 세트 ' + +tag.slice(2) : null);

// 조절 막대. 자간은 일러스트레이터처럼 1/1000em
const SLIDERS = [
  { label: '크기', min: 8, max: 400, step: 1, show: (v) => Math.round(v), css: (s, v) => { s.fontSize = v + 'px'; } },
  { label: '행간', min: 0.5, max: 3, step: 0.05, show: (v) => (+v).toFixed(2), css: (s, v) => { s.setProperty('--lh', v); } },
  { label: '자간', min: -100, max: 300, step: 5, show: (v) => String(Math.round(v)), css: (s, v) => { s.letterSpacing = v / 1000 + 'em'; } },
];
// 정렬 아이콘: 세 줄의 [시작, 끝] x좌표
const ALIGNS = [['left', '왼쪽 정렬', '0 16 0 10 0 13'], ['center', '가운데 정렬', '0 16 3 13 1.5 14.5'], ['right', '오른쪽 정렬', '0 16 6 16 3 16']];
// 이미지 비율 — 폭 1080, 높이. 3:4는 2025년부터 인스타 피드 기본
const RATIOS = [['9:16', 1920], ['3:4', 1440], ['4:5', 1350], ['1:1', 1080]];
const IMAGE_W = 1080;
const PHONE_W = 390;   // 인스타그램은 폰에서 보니, 이미지 여백·글자는 폰 화면 비율로 키운다

async function initTester(sec) {
  const buf = await fetch(sec.dataset.font).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)));
  const v = new DataView(buf), t = fontTables(v);
  const chars = fontChars(v, t);
  const feats = [...fontFeatures(v, t)].filter(featureName);
  const has = (ch) => /\s/.test(ch) || chars.has(ch.codePointAt(0));

  // 견본 문장: 페이지가 준 것 + 서체 파일에 든 글자 전부
  const samples = [...sec.querySelectorAll('[data-sample]')].map((b) => [b.textContent, b.dataset.sample]);
  sec.querySelectorAll('[data-sample]').forEach((b) => b.remove());
  samples.push(['모든 글자', String.fromCodePoint(...[...chars].filter((c) => c > 32).sort((a, b) => a - b))]);

  const box = document.createElement('div');
  box.innerHTML = `
    <div class="tester-bar">
      ${SLIDERS.map((o) => `<label class="tester-ctl"><span class="label">${o.label}</span>
        <input type="range" min="${o.min}" max="${o.max}" step="${o.step}"><output class="tester-value"></output></label>`).join('')}
      <div class="tester-group" role="group" aria-label="정렬">${ALIGNS.map(([to, name, x]) => {
        const p = x.split(' ');
        return `<button type="button" class="tester-icon" data-align="${to}" aria-label="${name}"><svg viewBox="0 0 16 12" aria-hidden="true"><path d="M${p[0]} 1H${p[1]}M${p[2]} 6H${p[3]}M${p[4]} 11H${p[5]}"/></svg></button>`;
      }).join('')}</div>
    </div>
    <div class="tester-bar">
      <div class="tester-group" role="group" aria-label="견본 문장">${samples.map(([name], i) => `<button type="button" class="chip" data-sample-i="${i}">${name}</button>`).join('')}</div>
      ${feats.length ? `<div class="tester-group" role="group" aria-label="오픈타입 기능">${feats.map((f) => `<button type="button" class="chip" data-feature="${f}">${featureName(f)} <span class="tag">${f}</span></button>`).join('')}</div>` : ''}
      <button type="button" class="chip" data-swap>색 바꾸기</button>
    </div>
    <div class="tester-box"><div class="tester-stage">
      <div class="tester-mirror" aria-hidden="true"></div>
      <textarea class="tester-text" rows="1" spellcheck="false" aria-label="써 보기"></textarea>
    </div></div>
    <div class="tester-bar">
      <span class="label">이미지로 내려받기</span>
      <div class="tester-group" role="group" aria-label="이미지 비율">${RATIOS.map(([r], i) => `<button type="button" class="chip" data-ratio="${i}">${r}</button>`).join('')}</div>
      <button type="button" class="chip is-primary" data-export>내려받기</button>
    </div>`;
  sec.append(...box.children);

  const stage = sec.querySelector('.tester-stage');
  const mirror = sec.querySelector('.tester-mirror');
  const text = sec.querySelector('.tester-text');
  const press = (btns, on) => btns.forEach((b) => b.setAttribute('aria-pressed', String(on(b))));

  // 조절 막대: 처음 값은 CSS(값 파일)에서 읽는다. 크기는 손대기 전까지 화면 폭을 따라간다
  const ctls = [...sec.querySelectorAll('.tester-ctl')];
  const current = () => {
    const s = getComputedStyle(stage), fs = parseFloat(s.fontSize);
    return [fs, parseFloat(s.lineHeight) / fs, parseFloat(s.letterSpacing) / fs * 1000 || 0];
  };
  const showAll = () => current().forEach((val, i) => {
    const input = ctls[i].querySelector('input');
    if (!input.dataset.touched) input.value = val;
    ctls[i].querySelector('output').textContent = SLIDERS[i].show(input.value);
  });
  ctls.forEach((ctl, i) => ctl.querySelector('input').addEventListener('input', (e) => {
    e.target.dataset.touched = '1';
    SLIDERS[i].css(stage.style, e.target.value);
    ctl.querySelector('output').textContent = SLIDERS[i].show(e.target.value);
  }));
  addEventListener('resize', showAll);

  // 정렬
  const aligns = [...sec.querySelectorAll('[data-align]')];
  const align = (to) => { stage.style.textAlign = to; press(aligns, (b) => b.dataset.align === to); };
  aligns.forEach((b) => b.addEventListener('click', () => align(b.dataset.align)));
  align('left');

  // 오픈타입 기능: 켜고 끄기
  const featBtns = [...sec.querySelectorAll('[data-feature]')];
  const on = Object.fromEntries(feats.map((f) => [f, ON_AT_START.has(f)]));
  const applyFeatures = () => {
    stage.style.fontFeatureSettings = feats.map((f) => `"${f}" ${on[f] ? 1 : 0}`).join(', ') || 'normal';
    press(featBtns, (b) => on[b.dataset.feature]);
  };
  featBtns.forEach((b) => b.addEventListener('click', () => { on[b.dataset.feature] = !on[b.dataset.feature]; applyFeatures(); }));
  applyFeatures();

  // 색 바꾸기: 써 보기 칸만 두 색을 뒤집는다
  const swap = sec.querySelector('[data-swap]');
  swap.setAttribute('aria-pressed', 'false');
  swap.addEventListener('click', () => {
    const now = sec.querySelector('.tester-box').classList.toggle('is-swapped');
    swap.setAttribute('aria-pressed', String(now));
  });

  // 글자는 뒤의 거울이 그리고, 위의 투명한 입력칸은 커서·선택만 맡는다 → 서체에 없는 글자만 흐리게
  const paint = () => {
    mirror.textContent = '';
    let run = '', runHas = true;
    const flush = () => {
      if (!run) return;
      const span = document.createElement('span');
      if (!runHas) span.className = 'is-missing';
      span.textContent = run;
      mirror.append(span);
      run = '';
    };
    for (const ch of text.value) {
      if (has(ch) !== runHas) { flush(); runHas = !runHas; }
      run += ch;
    }
    flush();
    // 끝이 빈 줄이면 그 줄도 높이를 갖게 폭 없는 글자 하나
    if (!text.value || text.value.endsWith('\n')) mirror.append('​');
  };
  // 서체에 없는 글자는 써지지 않는다 — 만든 글자만. 한글 입력기는 조합이 끝난 뒤에 거른다(조합 중에 거르면 입력이 꼬인다)
  const keepOnly = () => {
    const v = text.value, kept = [...v].filter(has).join('');
    if (kept === v) return;
    const caret = [...v.slice(0, text.selectionStart)].filter(has).join('').length;
    text.value = kept;
    text.setSelectionRange(caret, caret);
  };
  text.addEventListener('input', (e) => { if (!e.isComposing) keepOnly(); paint(); });
  text.addEventListener('compositionend', () => { keepOnly(); paint(); });

  // 견본 문장
  const sampleBtns = [...sec.querySelectorAll('[data-sample-i]')];
  const useSample = (i) => { text.value = samples[i][1]; paint(); press(sampleBtns, (b) => +b.dataset.sampleI === i); };
  sampleBtns.forEach((b) => b.addEventListener('click', () => useSample(+b.dataset.sampleI)));
  text.addEventListener('input', () => press(sampleBtns, () => false));
  useSample(0);
  showAll();

  // 서체 정보 칸도 파일에서 채운다 — 글자 수, 든 기능
  document.querySelectorAll('[data-fill="chars"]').forEach((el) => { el.textContent = [...chars].filter((c) => c > 32).length; });
  // 글리프 표 — 파일에 든 글자만 칸으로. 소문자 → 대문자 → 숫자 → 부호
  const kind = (c) => { const ch = String.fromCodePoint(c); return /\p{Ll}/u.test(ch) ? 0 : /\p{Lu}/u.test(ch) ? 1 : /\p{N}/u.test(ch) ? 2 : 3; };
  const glyphList = [...chars].filter((c) => c > 32).sort((a, b) => kind(a) - kind(b) || a - b);
  document.querySelectorAll('[data-fill="glyphs"]').forEach((el) => {
    el.replaceChildren(...glyphList.map((c) => {
      const cell = document.createElement('span');
      cell.className = 'glyph';
      cell.append(Object.assign(document.createElement('span'), { textContent: String.fromCodePoint(c) }));
      cell.title = `${cell.textContent}  U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
      return cell;
    }));
  });
  document.querySelectorAll('[data-fill="features"]').forEach((el) => { el.textContent = feats.map((f) => `${featureName(f)}(${f})`).join(' · ') || '없음'; });

  // ── 이미지로 내려받기 ──
  const ratioBtns = [...sec.querySelectorAll('[data-ratio]')];
  let ratio = 1;
  const pickRatio = (i) => { ratio = i; press(ratioBtns, (b) => +b.dataset.ratio === i); };
  ratioBtns.forEach((b) => b.addEventListener('click', () => pickRatio(+b.dataset.ratio)));
  pickRatio(1);

  // 캔버스는 오픈타입 기능을 못 켠다 → 기능을 미리 적용한 판(data-font-variants)으로 그린다.
  // ponytail: 판은 기능 하나씩만. 기능을 둘 넘게 켜는 서체가 오면 조합한 판을 만든다
  const variants = JSON.parse(sec.dataset.fontVariants || '{}');
  const loaded = {};
  const variantFamily = async () => {
    const f = feats.find((x) => on[x] && !ON_AT_START.has(x) && variants[x]);
    if (!f) return getComputedStyle(stage).fontFamily;
    loaded[f] ??= new FontFace('tester-' + f, `url(${new URL(variants[f], location.href)})`).load().then((ff) => document.fonts.add(ff));
    await loaded[f];
    return `"tester-${f}", ${getComputedStyle(stage).fontFamily}`;
  };

  const drawImage = async (W, H) => {
    const box = sec.querySelector('.tester-box'), ss = getComputedStyle(stage), root = getComputedStyle(document.documentElement);
    // 색: 써 보기 칸의 두 색(색 바꾸기 반영)과 흐린 글자색을 캔버스가 읽는 rgb로
    const probe = box.appendChild(document.createElement('span'));
    const col = (name) => {
      probe.style.color = `var(${name})`;
      const c = getComputedStyle(probe).color, n = c.match(/[\d.]+/g).slice(0, 3).map(Number);
      return `rgb(${(c.startsWith('color(') ? n.map((x) => x * 255) : n).join()})`;
    };
    const [bg, ink, mute] = ['--bg', '--ink', '--mute'].map(col);
    probe.remove();

    const k0 = W / PHONE_W;
    const m = parseFloat(root.getPropertyValue('--space-3')) * k0;         // 가장자리
    const capSize = parseFloat(root.getPropertyValue('--text-s')) * k0;    // 아래 한 줄 = 폰 본문 크기
    const k = (W - 2 * m) / stage.clientWidth;                            // 써 보기 칸 → 이미지
    const pl = parseFloat(ss.paddingLeft) * k, pr = parseFloat(ss.paddingRight) * k;
    let fs = parseFloat(ss.fontSize) * k;
    const lead = parseFloat(ss.lineHeight) / parseFloat(ss.fontSize);
    const track = (parseFloat(ss.letterSpacing) || 0) / parseFloat(ss.fontSize);
    const family = await variantFamily();
    await document.fonts.load(`${capSize}px "SUIT Variable"`);

    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = cv.getContext('2d');
    if ('fontKerning' in ctx) ctx.fontKerning = on.kern === false ? 'none' : 'normal';
    const maxW = W - 2 * m - pl - pr;
    const capGap = capSize * 2;
    const avail = H - 2 * m - capSize - capGap;

    // 줄 나누기: 낱말 단위, 한 낱말이 넘치면 글자 단위. 자간은 글자마다 더한다
    const width = (s) => ctx.measureText(s).width + fs * track * Math.max(0, [...s].length - 1);
    const layout = () => {
      ctx.font = `${fs}px ${family}`;
      const lines = [];
      for (const para of text.value.split('\n')) {
        let line = '';
        for (const word of para.split(/(\s+)/)) {
          if (width(line + word) <= maxW) { line += word; continue; }
          if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
          for (const ch of word.trimStart()) {
            if (line && width(line + ch) > maxW) { lines.push(line); line = ''; }
            line += ch;
          }
        }
        lines.push(line);
      }
      return lines;
    };
    let lines = layout();
    // 이미지보다 길면 잘리지 않게 줄인다
    for (let i = 0; i < 6 && lines.length * fs * lead > avail; i++) { fs *= Math.sqrt(avail / (lines.length * fs * lead)); lines = layout(); }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 기준선은 화면(CSS)처럼: 줄 높이에서 서체의 위아래 높이를 뺀 나머지를 반씩 — 다른 글꼴로 그린 글자도 같은 기준선에
    ctx.textBaseline = 'alphabetic';
    const fm = ctx.measureText('H'), asc = fm.fontBoundingBoxAscent, desc = fm.fontBoundingBoxDescent;
    const lh = fs * lead, top = m + Math.max(0, (avail - lines.length * lh) / 2);
    const to = stage.style.textAlign || 'left';
    lines.forEach((line, i) => {
      const lw = width(line);
      const x0 = m + pl + (to === 'center' ? (maxW - lw) / 2 : to === 'right' ? maxW - lw : 0);
      const chars = [...line];
      chars.forEach((ch, j) => {
        ctx.fillStyle = has(ch) ? ink : mute;
        ctx.fillText(ch, x0 + ctx.measureText(chars.slice(0, j).join('')).width + fs * track * j, top + lh * i + (lh - asc - desc) / 2 + asc);
      });
    });
    // 아래 한 줄 — 이름을 기억하게
    ctx.font = `${capSize}px "SUIT Variable", sans-serif`;
    ctx.fillStyle = mute;
    ctx.fillText(sec.dataset.credit || '', m, H - m);
    return cv;
  };

  // 폰은 공유 창(사진첩에 저장), PC는 파일로
  const save = (cv, name) => cv.toBlob(async (blob) => {
    const file = new File([blob], name, { type: 'image/png' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      return navigator.share({ files: [file] }).catch(() => {});
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');

  sec.querySelector('[data-export]').addEventListener('click', async () => {
    const [name, H] = RATIOS[ratio];
    save(await drawImage(IMAGE_W, H), `${sec.dataset.name || 'type'}-${name.replace(':', 'x')}.png`);
  });
}

document.querySelectorAll('.tester[data-font]').forEach((sec) => initTester(sec).catch(() => {})); // 서체 파일을 못 읽으면 조절판을 안 띄운다
