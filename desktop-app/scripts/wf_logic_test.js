// 独立验证 wfRun 的核心算法（拓扑 + 条件裁剪 + 可达性传播），与 app.js 逻辑一致。
function simulate(wfNodes, wfEdges) {
  const indeg = {}; wfNodes.forEach(n => indeg[n.id] = 0);
  wfEdges.forEach(e => { if (indeg[e.to] != null) indeg[e.to]++; });
  const adj = {}; wfNodes.forEach(n => adj[n.id] = []);
  wfEdges.forEach(e => { if (adj[e.from]) adj[e.from].push(e.to); });
  const q = wfNodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  const topo = [];
  while (q.length) { const id = q.shift(); topo.push(id); (adj[id] || []).forEach(t => { indeg[t]--; if (indeg[t] === 0) q.push(t); }); }
  if (topo.length !== wfNodes.length) return { error: 'cycle' };

  const key = e => e.from + '->' + e.to;
  const active = new Set(wfEdges.map(key));
  const incomingOf = id => wfEdges.filter(e => e.to === id);
  const reachable = new Set();
  wfNodes.filter(n => incomingOf(n.id).length === 0).forEach(n => reachable.add(n.id));
  const states = {};
  for (const id of topo) {
    const n = wfNodes.find(x => x.id === id);
    if (!reachable.has(id)) { states[id] = 'skipped'; continue; }
    if (n.type === 'cond') {
      const inc = incomingOf(id);
      const ups = inc.map(e => (wfNodes.find(x => x.id === e.from) || {}).data?.result || '');
      let pass = false;
      if (n.data.prompt && n.data.prompt.trim()) {
        try { pass = !!new Function('ctx', 'prev', 'return (' + n.data.prompt + ')').call(null, {}, ups.join('\n')); } catch (e) { states[id] = 'error'; }
      }
      const outs = wfEdges.filter(e => e.from === id);
      if (pass) outs.slice(1).forEach(e => active.delete(key(e))); else outs.slice(0, 1).forEach(e => active.delete(key(e)));
      states[id] = 'done';
    } else { states[id] = 'done'; }
    wfEdges.filter(e => e.from === id && active.has(key(e))).forEach(e => reachable.add(e.to));
  }
  return { states };
}

const N = (id, type, prompt) => ({ id, type, data: { prompt: prompt || '' } });
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// Case A: 线性 + 条件恒假，下游应被跳过
let a = simulate([N('r','ai'), N('c','cond','false'), N('x','tool')],
  [{from:'r',to:'c'},{from:'c',to:'x'}]);
console.log('Case A (线性+false分支):');
check('r 执行', a.states.r === 'done');
check('c 执行', a.states.c === 'done');
check('x 被跳过', a.states.x === 'skipped');

// Case B: 菱形汇聚，true 分支走通、false 分支跳过、汇聚点执行
let b = simulate([N('root','ai'), N('c','cond','true'), N('t','ai'), N('f','ai'), N('m','ai')],
  [{from:'root',to:'c'},{from:'c',to:'t'},{from:'c',to:'f'},{from:'t',to:'m'},{from:'f',to:'m'}]);
console.log('Case B (菱形汇聚):');
check('root 执行', b.states.root === 'done');
check('c 执行', b.states.c === 'done');
check('t(true) 执行', b.states.t === 'done');
check('f(false) 跳过', b.states.f === 'skipped');
check('m 汇聚执行', b.states.m === 'done');

// Case C: 环应报错
let c = simulate([N('a','ai'),N('b','ai')], [{from:'a',to:'b'},{from:'b',to:'a'}]);
console.log('Case C (环):');
check('检测到环', c.error === 'cycle');

// Case D: 普通线性全部执行
let d = simulate([N('a','ai'),N('b','tool'),N('c','output')], [{from:'a',to:'b'},{from:'b',to:'c'}]);
console.log('Case D (普通线性):');
check('a/b/c 均执行', d.states.a==='done' && d.states.b==='done' && d.states.c==='done');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
