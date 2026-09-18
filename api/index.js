// ═══ ТЕОРЕМА — игровой сервер (Vercel serverless) ═══
// БД: Upstash Redis по REST — переменные окружения
//   UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN
//   (совместим со старыми KV_REST_API_URL / KV_REST_API_TOKEN).
// Если переменных нет — встроенная in-memory БД (для локального запуска).

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const HAS_REDIS = !!(UP_URL && UP_TOK);

const crypto = require('crypto');
const ROOM_TTL = 7200; // комната удаляется после 2 ч бездействия
const CODE_AB = 'abcdefghjkmnpqrstuvwxyz23456789';
const MINUS = '−';

const TOPICS = [['eq','Уравнения'],['pow','Преобразования'],['der','Производная'],['pro','Вероятность'],
  ['pla','Планиметрия'],['ste','Стереометрия'],['txt','Текстовые']];
const TLBL = Object.fromEntries(TOPICS);

/* ── утилиты ── */
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SUP={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻','−':'⁻','x':'ˣ'};
const SUB={'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
const sup=s=>String(s).split('').map(c=>SUP[c]||'').join('');
const sub=s=>String(s).split('').map(c=>SUB[c]||'').join('');
const plural=(n,one,few,many)=>{const a=n%10,b=n%100;return (a===1&&b!==11)?one:(a>=2&&a<=4&&(b<10||b>=20))?few:many};
function lin(a,b){let s=(a===1?'':a)+'x';if(b)s+=b<0?` − ${Math.abs(b)}`:` + ${b}`;return s}
function poly3(A,B){let s='x³';if(A)s+=A<0?` − ${Math.abs(A)}x²`:` + ${A}x²`;if(B)s+=B<0?` − ${Math.abs(B)}x`:` + ${B}x`;return s+' + 7'}
function fmtAnswer(v,p){let s=p>0?(+v).toFixed(p).replace(/0+$/,'').replace(/[.,]$/,''):String(Math.round(v));
  return s.replace('-','−').replace('.',',')}
function parseAnswer(raw){
  const s=String(raw==null?'':raw).trim().replace(',','.').replace(/[−–—]/g,'-').replace(/\s+/g,'');
  const f=/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(s);
  if(f){const d=parseFloat(f[2]);return d?parseFloat(f[1])/d:null}
  return /^-?\d+(\.\d+)?$/.test(s)?parseFloat(s):null;
}
const cleanName=s=>{s=String(s||'').replace(/\s+/g,' ').trim().slice(0,16);
  return s||pick(['Пифагор','Эйлер','Ковалевская','Гаусс','Гипатия','Коши'])};
const genCode=()=>Array.from({length:6},()=>pick(CODE_AB.split(''))).join('');
const newToken=()=>crypto.randomBytes(12).toString('hex');

/* ── БД-адаптер: Upstash REST или память ── */
async function rcmd(args){
  const r=await fetch(UP_URL,{method:'POST',
    headers:{Authorization:'Bearer '+UP_TOK,'Content-Type':'application/json'},
    body:JSON.stringify(args)});
  const j=await r.json();
  if(j.error) throw new Error('redis: '+j.error);
  return j.result;
}
const MEM=new Map();
async function dbSet(k,v,ttl,opt){
  if(HAS_REDIS){const a=['SET',k,v,'EX',String(ttl||ROOM_TTL)];if(opt&&opt.nx)a.push('NX');return rcmd(a)}
  if(opt&&opt.nx){const e=MEM.get(k);if(e&&e.exp>Date.now())return null}
  MEM.set(k,{v,exp:Date.now()+(ttl||ROOM_TTL)*1000});return 'OK';
}
async function dbGet(k){
  if(HAS_REDIS)return rcmd(['GET',k]);
  const e=MEM.get(k);if(!e)return null;
  if(e.exp<Date.now()){MEM.delete(k);return null}
  return e.v;
}
async function dbDel(k){ if(HAS_REDIS)return rcmd(['DEL',k]); MEM.delete(k); }
async function dbRpush(k,v){
  if(HAS_REDIS)return rcmd(['RPUSH',k,v]);
  const e=MEM.get(k);const arr=(e&&e.exp>Date.now())?e.v:[];
  arr.push(v);MEM.set(k,{v:arr,exp:Date.now()+30*86400*1000});
}
async function dbLrange(k){
  if(HAS_REDIS)return (await rcmd(['LRANGE',k,'0','-1']))||[];
  const e=MEM.get(k);return (e&&e.exp>Date.now())?e.v:[];
}
async function dbLlen(k){
  if(HAS_REDIS)return (await rcmd(['LLEN',k]))||0;
  const e=MEM.get(k);return (e&&e.exp>Date.now())?e.v.length:0;
}
const getRoom=async code=>{const s=await dbGet('room:'+code);if(!s)return null;try{return JSON.parse(s)}catch(e){return null}};
const saveRoom=(code,room)=>dbSet('room:'+code,JSON.stringify(room),ROOM_TTL);

/* ── генераторы задач (резервный банк) ── */
function g_linear(){const x=rnd(-9,9),a=rnd(2,9),b=rnd(-20,20),c=a*x+b;
  return{text:`Найдите корень уравнения ${lin(a,b)} = ${c<0?MINUS+Math.abs(c):c}.`,ans:x,prec:0}}
function g_quadratic(){let p=rnd(-9,9),q=rnd(-9,9);while(q===p)q=rnd(-9,9);
  const B=-(p+q),C=p*q;let s='x²';
  if(B)s+=B<0?` − ${Math.abs(B)}x`:` + ${B}x`;if(C)s+=C<0?` − ${Math.abs(C)}`:` + ${C}`;
  return{text:`Решите уравнение ${s} = 0. Если корней несколько, в ответе укажите больший.`,ans:Math.max(p,q),prec:0}}
function g_exponential(){const a=pick([2,3,4,5]);
  if(Math.random()<.6){const k=rnd(2,5),n=rnd(1,9);
    return{text:`Найдите корень уравнения ${a}${sup('x-'+n)} = ${a**k}.`,ans:k+n,prec:0}}
  const k=rnd(2,5),n=rnd(k+1,k+9);
  return{text:`Найдите корень уравнения (1/${a})${sup('x-'+n)} = ${a**k}.`,ans:n-k,prec:0}}
function g_logarithm(){const a=pick([2,3,5]),k=rnd(2,4);
  if(Math.random()<.5){const n=rnd(1,Math.min(30,a**k-1));
    return{text:`Найдите корень уравнения log${sub(a)}(x + ${n}) = ${k}.`,ans:a**k-n,prec:0}}
  const n=rnd(1,20);
  return{text:`Найдите корень уравнения log${sub(a)}(x − ${n}) = ${k}.`,ans:a**k+n,prec:0}}
function g_trig(){
  for(let t=0;t<200;t++){
    const f=Math.random()<.5?'sin':'cos',k=pick([2,3,4,6]);
    const bank=f==='sin'
      ?[['1/2',[30,150]],['√2/2',[45,135]],['√3/2',[60,120]],[MINUS+'1/2',[210,330]],['1',[90]],[MINUS+'1',[270]]]
      :[['1/2',[60,300]],['√2/2',[45,315]],['√3/2',[30,330]],[MINUS+'1/2',[120,240]],['1',[0]],[MINUS+'1',[180]]];
    const[sv,ts]=pick(bank);
    if((k*ts[0])%180!==0)continue;
    const cands=[];for(let n=-6;n<=6;n++)for(const tt of ts)cands.push(k*tt/180+2*k*n);
    const pos=cands.filter(x=>x>0),neg=cands.filter(x=>x<0);
    if(!pos.length||!neg.length)continue;
    const mp=Math.random()<.5;
    return{text:`Решите уравнение ${f}(πx/${k}) = ${sv}. В ответе укажите ${mp?'наименьший положительный':'наибольший отрицательный'} корень.`,
      ans:mp?Math.min(...pos):Math.max(...neg),prec:0};
  }
  return{text:'Решите уравнение sin(πx/3) = √3/2. В ответе укажите наименьший положительный корень.',ans:1,prec:0}}
function g_powers(){const A=pick([2,3,5,10]),m=rnd(2,7),n=rnd(1,6),k=rnd(1,6),e=m+n-k;
  if(e>=1&&e<=5)return{text:`Найдите значение выражения a${sup(m)} · a${sup(n)} / a${sup(k)}, если a = ${A}.`,ans:A**e,prec:0};
  const m2=rnd(2,3),n2=rnd(2,3),k2=rnd(1,m2*n2-1);
  return{text:`Найдите значение выражения (a${sup(m2)})${sup(n2)} / a${sup(k2)}, если a = ${A}.`,ans:A**(m2*n2-k2),prec:0}}
function g_quadmin(){const a=rnd(-9,9)||5,c=rnd(-15,15),b=-2*a;let s='x²';
  if(b)s+=b<0?` − ${Math.abs(b)}x`:` + ${b}x`;if(c)s+=c<0?` − ${Math.abs(c)}`:` + ${c}`;
  return{text:`Найдите точку минимума функции y = ${s}.`,ans:a,prec:0}}
function g_cubicmin(){const u=rnd(-5,2),v=u+rnd(1,4),A=-(v+2*u),B=u*u+2*u*v;
  return{text:`Найдите точку минимума функции y = ${poly3(A,B)}.`,ans:v,prec:0}}
function g_derivgraph(){
  const ys=[];let y=rnd(-3,3);
  for(let i=0;i<13;i++){if(y===0)y=Math.random()<.5?1:-1;ys.push(y);y=Math.max(-4,Math.min(4,y+rnd(-2,2)))}
  const pos=ys.filter(v=>v>0).length,neg=ys.filter(v=>v<0).length;
  let zeros=0;for(let i=0;i<12;i++)if(ys[i]*ys[i+1]<0)zeros++;
  const opts=[
    [`укажите количество целых точек отрезка [−6; 6], в которых производная функции f(x) положительна.`,pos],
    [`укажите количество целых точек отрезка [−6; 6], в которых производная функции f(x) отрицательна.`,neg]];
  if(zeros)opts.push(['укажите количество точек, в которых производная функции f(x) равна нулю.',zeros]);
  const[q,answ]=pick(opts);
  const X=x=>40+(x+6)*40,Y=v=>160-28*v;let g='';
  for(let x=-6;x<=6;x++)g+=`<line x1="${X(x)}" y1="26" x2="${X(x)}" y2="294" stroke="rgba(33,29,23,.09)"/>`;
  for(let v=-4;v<=4;v++)g+=`<line x1="40" y1="${Y(v)}" x2="520" y2="${Y(v)}" stroke="rgba(33,29,23,.09)"/>`;
  g+='<line x1="34" y1="160" x2="528" y2="160" stroke="#211D17" stroke-width="1.6"/>';
  g+=`<line x1="${X(0)}" y1="26" x2="${X(0)}" y2="294" stroke="#211D17" stroke-width="1.6"/>`;
  for(let x=-6;x<=6;x++){
    g+=`<line x1="${X(x)}" y1="156" x2="${X(x)}" y2="164" stroke="#211D17" stroke-width="1.4"/>`;
    g+=`<text x="${X(x)}" y="182" font-size="10.5" text-anchor="middle" fill="rgba(33,29,23,.5)">${x===0?'':x}</text>`}
  const pts=ys.map((v,i)=>`${X(i-6)},${Y(v)}`).join(' ');
  const svg=`<svg viewBox="0 0 560 320" xmlns="http://www.w3.org/2000/svg">${g}<polyline points="${pts}" fill="none" stroke="#211D17" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return{text:`На рисунке изображён график y = f′(x) — производной функции f(x), определённой на интервале (−7; 7). ${q[0].toUpperCase()+q.slice(1)}`,
    ans:answ,prec:0,img:svg}}
function g_pies(){const N=pick([4,5,8,10,16,20,25]),M=rnd(1,N-1);
  return{text:`На тарелке лежат ${N} ${plural(N,'пирожка','пирожков','пирожков')}: ${M} ${plural(M,'пирожок','пирожка','пирожков')} с капустой, остальные — с яблоками. Найдите вероятность того, что случайно выбранный пирожок окажется с яблоками. Ответ округлите до сотых.`,ans:(N-M)/N,prec:2}}
function g_dice(){const s=rnd(2,12),c=[0,0,1,2,3,4,5,6,5,4,3,2,1][s];
  return{text:`Игральный кубик бросают дважды. Найдите вероятность того, что сумма выпавших очков равна ${s}. Ответ округлите до сотых.`,ans:c/36,prec:2}}
function g_tickets(){const N=pick([10,20,25,40,50]),M=rnd(1,N-1);
  return{text:`На экзамене по механике ${N} ${plural(N,'билет','билета','билетов')}, из которых ${M} студент не выучил. Найдите вероятность того, что ему попадётся выученный билет. Ответ округлите до сотых.`,ans:(N-M)/N,prec:2}}
function g_trisides(){const a=rnd(6,20),b=rnd(6,20),s=pick([0.4,0.5,0.6]);
  return{text:`Две стороны треугольника равны ${a} и ${b}, а синус угла между ними равен ${String(s).replace('.',',')}. Найдите площадь этого треугольника.`,ans:a*b*s/2,prec:2}}
function g_righttri(){const a=rnd(3,16),b=rnd(3,16);
  return{text:`В прямоугольном треугольнике катеты равны ${a} и ${b}. Найдите площадь этого треугольника.`,ans:a*b/2,prec:1}}
function g_rhombus(){const m=rnd(2,7);
  return{text:`Сторона ромба равна ${2*m}, а один из углов этого ромба равен 30°. Найдите площадь ромба.`,ans:2*m*m,prec:0}}
function g_box(){const a=rnd(2,9),b=rnd(2,9),c=rnd(2,9);
  return{text:`Два ребра прямоугольного параллелепипеда, выходящие из одной вершины, равны ${a} и ${b}. Объём параллелепипеда равен ${a*b*c}. Найдите третье ребро, выходящее из той же вершины.`,ans:c,prec:0}}
function g_pyramid(){const h=rnd(2,12),S=3*rnd(2,15);
  return{text:`Площадь основания пирамиды равна ${S}, а высота пирамиды равна ${h}. Найдите её объём.`,ans:S*h/3,prec:0}}
function g_percent(){
  for(let t=0;t<300;t++){const base=pick([800,1000,1200,1600,2000,2400,3000,4000]),p=rnd(5,50),q=rnd(5,50);
    const f=base*(1+p/100)*(1-q/100);
    if(Math.abs(f-Math.round(f))<1e-9)
      return{text:`Куртка стоила ${base} рублей. На распродаже её цену сначала повысили на ${p}%, а затем снизили на ${q}%. Сколько рублей стала стоить куртка после снижения цены?`,ans:Math.round(f),prec:0}}
  return{text:'Куртка стоила 1000 рублей. На распродаже её цену сначала повысили на 10%, а затем снизили на 10%. Сколько рублей стала стоить куртка после снижения цены?',ans:990,prec:0}}
function g_speed(){
  for(let t=0;t<300;t++){const t1=rnd(1,4),t2=rnd(1,4),v1=rnd(3,12)*10,v2=rnd(3,12)*10;
    const s=(t1*v1+t2*v2)/(t1+t2);
    if(Math.abs(s-Math.round(s))<1e-9)
      return{text:`Первые ${t1} ${plural(t1,'час','часа','часов')} велосипедист ехал со скоростью ${v1} км/ч, следующие ${t2} ${plural(t2,'час','часа','часов')} — со скоростью ${v2} км/ч. Найдите среднюю скорость велосипедиста на всём пути. Ответ дайте в км/ч.`,ans:Math.round(s),prec:0}}
  return{text:'Первый час велосипедист ехал со скоростью 50 км/ч, следующий час — со скоростью 70 км/ч. Найдите его среднюю скорость. Ответ дайте в км/ч.',ans:60,prec:0}}

const GENS=[['eq',g_linear],['eq',g_quadratic],['eq',g_exponential],['eq',g_logarithm],['eq',g_trig],
  ['pow',g_powers],['der',g_quadmin],['der',g_cubicmin],['der',g_derivgraph],
  ['pro',g_pies],['pro',g_dice],['pro',g_tickets],
  ['pla',g_trisides],['pla',g_righttri],['pla',g_rhombus],
  ['ste',g_box],['ste',g_pyramid],['txt',g_percent],['txt',g_speed]];

/* ── парсер прототипов (зеркало банка ФИПИ) ── */
const ENT={'amp':'&','lt':'<','gt':'>','quot':'"','#39':"'",'nbsp':' ','laquo':'«','raquo':'»',
  'mdash':'—','ndash':'–','minus':'−','times':'×','divide':'÷','deg':'°','pi':'π','radic':'√','le':'≤','ge':'≥','ne':'≠'};
function unesc(s){return s
  .replace(/&(amp|lt|gt|quot|#39|nbsp|laquo|raquo|mdash|ndash|minus|times|divide|deg|pi|radic|le|ge|ne);/g,(m,e)=>ENT[e])
  .replace(/&#(\d+);/g,(m,d)=>String.fromCodePoint(+d))}
function stripTags(h){
  h=h.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ');
  h=h.replace(/<img[^>]*>/gi,' ⟨рисунок⟩ ');
  h=h.replace(/<[^>]+>/g,' ');
  return unesc(h).replace(/[ \t]+/g,' ');
}
async function fetchProblem(pid){
  const r=await fetch('https://math-ege.sdamgia.ru/problem?id='+pid,
    {signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const txt=stripTags(await r.text());
  const mh=/Задание\s*(\d+)\s*№\s*(\d+)/.exec(txt);
  if(!mh)throw new Error('задача не найдена (проверьте id)');
  const body=txt.slice(mh.index+mh[0].length);
  const ma=/Ответ\s*[:\-—]?\s*([^\n\r]+)/.exec(body);
  if(!ma)throw new Error('ответ на странице не найден');
  const text=body.slice(0,ma.index).replace(/\s+/g,' ').trim().replace(/^[.·\s]+/,'');
  const raw=ma[1].split(/\s+Решение/)[0].trim().replace(/[.\s]+$/,'');
  const norm=raw.replace('−','-').replace(',','.');
  let ans=null,prec=0;
  if(/^-?\d+(\.\d+)?$/.test(norm)){ans=parseFloat(norm);prec=norm.includes('.')?norm.split('.')[1].length:0}
  if(!text)throw new Error('пустой текст задачи');
  return{text,ans,raw,prec,task:mh[1]};
}

/* ── игровая логика ── */
function freshRoom(code,name){
  return{code,ver:1,tokens:[newToken(),null],names:[name,null],seen:[Date.now(),0],
    settings:{target:5,time:120,source:'mix',topics:Object.fromEntries(TOPICS.map(([k])=>[k,true]))},
    phase:'lobby',scores:[0,0],hist:[],tries:[0,0],roundN:0,round:null,between:null,
    pendingSkip:null,lastSkip:null,winner:null,note:null,deck:[],used:{},
    stats:[{solved:0,sum:0,best:null,wrong:0},{solved:0,sum:0,best:null,wrong:0}]};
}
function resetMatch(room,now){
  Object.assign(room,{scores:[0,0],hist:[],tries:[0,0],roundN:0,used:{},deck:[],
    winner:null,round:null,pendingSkip:null,lastSkip:null,note:null,
    stats:[{solved:0,sum:0,best:null,wrong:0},{solved:0,sum:0,best:null,wrong:0}]});
  room.phase='between';room.between={until:now+1200,last:null,finalAfter:false};
}
async function pickTask(room){
  const src=room.settings.source;
  let bank=[];
  if(src!=='gen')bank=(await dbLrange('teo_bank')).map(s=>{try{return JSON.parse(s)}catch(e){return null}}).filter(Boolean);
  if(bank.length&&(src==='bank'||Math.random()<0.5)){
    const start=Math.floor(Math.random()*bank.length);
    for(let i=0;i<Math.min(bank.length,12);i++){
      const bp=bank[(start+i)%bank.length],sig='b|'+bp.text.slice(0,80);
      if(!room.used[sig]){room.used[sig]=1;
        return{text:bp.text,answer:bp.ans,rawans:bp.raw||null,prec:bp.prec||0,
          topic:'Задание '+(bp.task!=null?bp.task:'?')+' · банк ФИПИ',img:''}}
    }
    for(const bp of bank)delete room.used['b|'+bp.text.slice(0,80)];
    const bp=bank[start];room.used['b|'+bp.text.slice(0,80)]=1;
    return{text:bp.text,answer:bp.ans,rawans:bp.raw||null,prec:bp.prec||0,
      topic:'Задание '+(bp.task!=null?bp.task:'?')+' · банк ФИПИ',img:''};
  }
  const pool=GENS.filter(([c])=>room.settings.topics[c]);
  if(!pool.length)return null;
  if(!room.deck.length){room.deck=pool.slice();
    for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]]}}
  const[cat,fn]=room.deck.pop();
  let task=fn(),sig=task.text+'|'+task.ans,guard=0;
  while(room.used[sig]&&guard<60){task=fn();sig=task.text+'|'+task.ans;guard++}
  room.used[sig]=1;
  return{text:task.text,answer:task.ans,rawans:null,prec:task.prec,topic:(TLBL[cat]||'')+' · прототип банка',img:task.img||''};
}
async function startRound(room,now){
  const task=await pickTask(room);
  if(!task){room.phase='lobby';room.between=null;room.pendingSkip=null;
    room.note='Нет задач: пополните банк или включите темы генераторов.';room.ver++;return}
  room.roundN++;
  room.round={n:room.roundN,text:task.text,topic:task.topic,img:task.img,
    answer:task.answer,rawans:task.rawans,prec:task.prec,
    started:now,deadline:now+room.settings.time*1000};
  room.tries=[0,0];room.pendingSkip=null;room.lastSkip=null;room.note=null;room.ver++;
}
function finishRound(room,kind,ms,now){
  const r=room.round;
  if(kind===0)room.scores[0]++;else if(kind===1)room.scores[1]++;
  room.hist.push(kind);
  const done=room.scores[0]>=room.settings.target||room.scores[1]>=room.settings.target;
  room.between={until:now+5000,last:{n:r.n,kind,answer:r.rawans||fmtAnswer(r.answer,r.prec),ms},finalAfter:done};
  room.round=null;room.pendingSkip=null;room.ver++;
}
async function tick(room,now){
  let ch=false;
  if(room.phase==='round'&&room.round&&now>=room.round.deadline){finishRound(room,'draw',null,now);ch=true}
  if(room.phase==='between'&&room.between&&now>=room.between.until){
    if(room.between.finalAfter){room.phase='final';
      room.winner=room.scores[0]>=room.settings.target?0:1;
      room.between=null;room.ver++}
    else await startRound(room,now);
    ch=true;
  }
  if(room.pendingSkip&&now>=room.pendingSkip.until){
    room.lastSkip={to:room.pendingSkip.by,res:'timeout',n:room.pendingSkip.n};
    room.pendingSkip=null;room.ver++;ch=true;
  }
  return ch;
}
function view(room,seat,now){
  const opp=1-seat;
  return{v:room.ver,you:seat,names:room.names,
    online:[now-(room.seen[seat]||0)<15000,now-(room.seen[opp]||0)<15000],
    phase:room.phase,scores:room.scores,hist:room.hist,tries:room.tries,
    target:room.settings.target,time:room.settings.time,
    topics:room.settings.topics,source:room.settings.source,note:room.note||null,
    round:room.round?{n:room.round.n,text:room.round.text,topic:room.round.topic,
      img:room.round.img,prec:room.round.prec,deadline:room.round.deadline}:null,
    between:room.between?{until:room.between.until,last:room.between.last,finalAfter:room.between.finalAfter}:null,
    pendingSkip:room.pendingSkip?{by:room.pendingSkip.by,n:room.pendingSkip.n,until:room.pendingSkip.until}:null,
    skipEvent:(room.lastSkip&&room.lastSkip.to===seat)?room.lastSkip:null,
    myStats:room.stats[seat],winner:room.winner,servertime:now};
}
/* сериализация мутаций комнаты через короткий мьютекс */
async function mutate(code,fn){
  for(let i=0;i<6;i++){
    const tok='l'+crypto.randomBytes(4).toString('hex');
    if(await dbSet('lock:'+code,tok,5,{nx:true})){
      try{
        const room=await getRoom(code);
        const out=await fn(room);
        if(out&&out.changed&&room)await saveRoom(code,room);
        return out||{resp:{error:'сбой'}};
      }finally{
        const cur=await dbGet('lock:'+code);
        if(cur===tok)await dbDel('lock:'+code);
      }
    }
    await sleep(60+Math.random()*80);
  }
  return{resp:{error:'сервер занят, повторите'},code:503};
}

/* ── HTTP ── */
function json(res,code,obj){
  res.statusCode=code;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(Buffer.from(JSON.stringify(obj),'utf8'));
}
async function gameGet(url,res){
  const code=(url.searchParams.get('code')||'').toLowerCase();
  const token=url.searchParams.get('token')||'';
  const v=url.searchParams.get('v');
  if(!/^[a-z0-9]{6}$/.test(code))return json(res,400,{error:'неверный код комнаты'});
  const now=Date.now();
  const out=await mutate(code,async room=>{
    if(!room)return{resp:{error:'Комната не найдена или устарела'},code:404};
    const seat=room.tokens.indexOf(token);
    if(seat<0)return{resp:{error:'Сессия устарела — войдите заново'},code:401};
    room.seen[seat]=now;
    const changed=await tick(room,now);
    return{resp:{__view:view(room,seat,now),__v:room.ver},changed};
  });
  if(out.error)return json(res,out.code||400,out);
  if(String(out.__v)===String(v))return json(res,200,{same:true});
  return json(res,200,{room:out.__view});
}
async function action(d,res){
  const now=Date.now(),act=d.action;
  if(act==='create'){
    let code=null;
    for(let i=0;i<8;i++){const c=genCode();if(!(await getRoom(c))){code=c;break}}
    if(!code)return json(res,500,{error:'не удалось выделить код, попробуйте ещё'});
    const room=freshRoom(code,cleanName(d.name));
    await saveRoom(code,room);
    return json(res,200,{code,token:room.tokens[0],seat:0});
  }
  const code=String(d.code||'').toLowerCase();
  if(!/^[a-z0-9]{6}$/.test(code))return json(res,400,{error:'укажите код комнаты (6 символов)'});

  if(act==='join'){
    const out=await mutate(code,async room=>{
      if(!room)return{resp:{error:'Комната не найдена. Проверьте код.'},code:404};
      if(room.tokens[1])return{resp:{error:'В этой комнате уже играют вдвоём'},code:409};
      const tok=newToken();
      room.tokens[1]=tok;room.names[1]=cleanName(d.name);room.seen[1]=now;room.ver++;
      return{resp:{code,token:tok,seat:1},changed:true};
    });
    return json(res,out.error?(out.code||400):200,out);
  }
  if(act==='bankAdd'||act==='bankInfo'||act==='bankClear'){
    const room=await getRoom(code);
    const seat=room?room.tokens.indexOf(d.token||''):-1;
    if(seat!==0)return json(res,403,{error:'банком управляет создатель комнаты'});
    if(act==='bankInfo')return json(res,200,{bankN:await dbLlen('teo_bank')});
    if(act==='bankClear'){await dbDel('teo_bank');return json(res,200,{ok:true,bankN:0})}
    const ids=[...new Set(String(d.ids||'').split(/[^0-9]+/).filter(Boolean).map(Number))].slice(0,6);
    if(!ids.length)return json(res,400,{error:'укажите номера задач (до 6 за раз)'});
    const added=[],errs=[];
    for(const id of ids){
      try{const p=await fetchProblem(id);await dbRpush('teo_bank',JSON.stringify(p));
        added.push({id,task:p.task,text:p.text.slice(0,60),raw:p.raw})}
      catch(e){errs.push({id,err:String(e.message||e)})}
    }
    return json(res,200,{added,errs,bankN:await dbLlen('teo_bank')});
  }
  const out=await mutate(code,async room=>{
    if(!room)return{resp:{error:'Комната не найдена'},code:404};
    const seat=room.tokens.indexOf(d.token||'');
    if(seat<0)return{resp:{error:'Сессия устарела — войдите заново'},code:401};
    let changed=await tick(room,now),resp={ok:true};
    switch(act){
      case 'settings':{
        if(seat!==0||room.phase!=='lobby'){resp={error:'настройки меняет создатель до старта'};break}
        const s=d.settings||{};
        if([3,5,7].includes(+s.target))room.settings.target=+s.target;
        if([60,90,120,180,240].includes(+s.time))room.settings.time=+s.time;
        if(['gen','bank','mix'].includes(s.source))room.settings.source=s.source;
        if(s.topics)for(const[k]of TOPICS)if(k in s.topics)room.settings.topics[k]=!!s.topics[k];
        changed=true;break;
      }
      case 'start':{
        if(seat!==0){resp={error:'стартует создатель комнаты'};break}
        if(!room.tokens[1]){resp={error:'ждём второго игрока'};break}
        if(room.settings.source==='gen'&&!Object.values(room.settings.topics).some(Boolean)){
          resp={error:'выберите хотя бы одну тему'};break}
        resetMatch(room,now);changed=true;break;
      }
      case 'answer':{
        const r=room.round;
        if(room.phase!=='round'||!r||+d.n!==r.n){resp={ok:false,msg:'раунд уже завершён'};break}
        const val=parseAnswer(d.value);
        if(val===null){resp={ok:false,msg:'Введите число или дробь вида 7/3.'};break}
        let good;
        if(r.answer!=null){const tol=Math.pow(10,-(r.prec||0))/2+1e-9;good=Math.abs(val-r.answer)<=tol}
        else good=String(d.value).trim().replace(',','.').replace(/\s/g,'')===String(r.rawans||'').trim().replace('−','-');
        room.tries[seat]++;
        if(!good){room.stats[seat].wrong++;resp={ok:false,msg:'неверно'};changed=true;break}
        const ms=now-r.started,st=room.stats[seat];
        st.solved++;st.sum+=ms;st.best=st.best==null?ms:Math.min(st.best,ms);
        finishRound(room,seat,ms,now);changed=true;break;
      }
      case 'skip':{
        const r=room.round;
        if(room.phase!=='round'||!r||+d.n!==r.n){resp={error:'раунд не активен'};break}
        if(room.pendingSkip){resp={error:'запрос уже отправлен'};break}
        room.pendingSkip={by:seat,n:r.n,until:now+15000};changed=true;break;
      }
      case 'skipReply':{
        const p=room.pendingSkip;
        if(!p||p.by===seat){resp={error:'нет запроса к вам'};break}
        if(d.ok)finishRound(room,'skip',null,now);
        else room.lastSkip={to:p.by,res:'no',n:p.n};
        room.pendingSkip=null;changed=true;break;
      }
      case 'rematch':{
        if(seat!==0||room.phase!=='final'){resp={error:'реванш недоступен'};break}
        resetMatch(room,now);changed=true;break;
      }
      default:resp={error:'неизвестное действие'};
    }
    return{resp,changed};
  });
  return json(res,out.error?(out.code||400):200,out);
}
module.exports=async(req,res)=>{
  try{
    const url=new URL(req.url,'http://x');
    if(req.method==='GET'){
      if(url.pathname==='/api'||url.pathname==='/api/')return await gameGet(url,res);
      return json(res,404,{error:'нет маршрута'});
    }
    if(req.method==='POST'){
      let body='';
      req.on('data',c=>{body+=c;if(body.length>1e5)req.destroy()});
      await new Promise(r=>req.on('end',r));
      let d={};try{d=JSON.parse(body||'{}')}catch(e){}
      return await action(d,res);
    }
    return json(res,405,{error:'метод не поддерживается'});
  }catch(e){try{json(res,500,{error:'внутренняя ошибка: '+(e.message||e)})}catch(_){}}
};
module.exports.maxDuration=30;

/* локальный запуск без Vercel: node api/index.js */
if(require.main===module){
  const http=require('http');
  const port=process.env.PORT||3000;
  http.createServer((req,res)=>module.exports(req,res)).listen(port,()=>{
    console.log('ТЕОРЕМА: http://localhost:'+port);
    console.log(HAS_REDIS?'БД: Upstash Redis':'БД: встроенная in-memory (для теста)');
  });
}
