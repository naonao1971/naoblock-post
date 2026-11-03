// 作品データから、斜め上から見た小さな絵（サムネ）を描く。投稿するときに 1 回だけ描いて、データと一緒に送る
// plan：{ bricks: [{ col, cells: [[x, y, z], ...] }] }（z=0 が手前）。colors：{ 色の名前: [r, g, b] }
window.NB_THUMB = (plan, colors, px = 240) => {
  const cubes = [];
  const D = Math.max(...plan.bricks.flatMap(b => b.cells.map(c => c[2]))) + 1;
  for (const b of plan.bricks) for (const [x, y, z] of b.cells) cubes.push({ x, y, z: D - 1 - z, rgb: colors[b.col] || [200, 200, 200] });   // z を裏返して、手前を画面の下側に
  // 奥から手前へ、下から上へ描く（あとに描いたものが前に来る）
  cubes.sort((a, b) => (a.x + a.z) - (b.x + b.z) || a.y - b.y || a.x - b.x);
  const P = (X, Y, Z) => [(X - Z) * 0.866, (X + Z) * 0.5 - Y * 1.0];
  // 全体の大きさを測って、絵の中に収める
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cubes) for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    const [sx, sy] = P(c.x + dx, c.y + dy, c.z + dz);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  const pad = px * 0.06, s = Math.min((px - pad * 2) / (maxX - minX), (px - pad * 2) / (maxY - minY));
  const ox = (px - (maxX - minX) * s) / 2 - minX * s, oy = (px - (maxY - minY) * s) / 2 - minY * s;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.5, s * 0.06);
  const face = (pts, rgb, k) => {
    g.beginPath();
    pts.forEach(([X, Y, Z], i) => { const [sx, sy] = P(X, Y, Z); g[i ? 'lineTo' : 'moveTo'](ox + sx * s, oy + sy * s); });
    g.closePath();
    g.fillStyle = `rgb(${rgb.map(v => Math.round(v * k)).join(',')})`;
    g.strokeStyle = `rgba(0,0,0,.18)`;
    g.fill(); g.stroke();
  };
  for (const { x, y, z, rgb } of cubes) {
    face([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], rgb, 1.0);   // 上
    face([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], rgb, 0.82);  // 手前
    face([[x + 1, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]], rgb, 0.66);  // 右
  }
  return cv.toDataURL('image/png');
};
