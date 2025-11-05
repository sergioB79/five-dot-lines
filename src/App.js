import React, { useMemo, useState, useEffect } from "react";

/**
 * Five‑Dot Lines — Solo Game (React + SVG)
 *
 * Features
 *  - Start seed: two horizontal lines of 8 and two vertical lines of 8 (2‑dot‑wide plus at center)
 *  - Legal move: placing a dot must create ≥1 straight 5‑window (H/V/diagonals) including the new dot
 *  - No overlap on the SAME axis with previously scored fives (cannot extend a scored 5 into 6)
 *  - Can score up to TWO windows per axis in one move (left‑heavy + right‑heavy), per your rule #2
 *  - Draw black segments across scored fives; hover preview; one‑time “Show Moves” reveal
 *  - Highscore persisted (localStorage); Dark/Light toggle; Mute toggle; small flash animation on score
 *  - Easier clicking: click anywhere on the SVG maps to nearest cell; per‑cell hit area
 *
 * Self‑tests are included via console.assert (run once on mount)
 */

// ----- Board & visuals -----
const N = 21; // odd → clear center
const CENTER = Math.floor(N / 2);
const CELL = 28; // px cell size
const PADDING = 24; // outer padding

// ----- Utils -----
const clone = (b) => b.map((row) => row.slice());
const makeEmptyBoard = () => Array.from({ length: N }, () => Array.from({ length: N }, () => 0));
const inside = (x, y) => x >= 0 && x < N && y >= 0 && y < N;

// Two horizontal lines of 8 and two vertical lines of 8 (2‑rows + 2‑cols) centered
function seedInitialCross(board) {
  const b = clone(board);
  const length = 8; // total dots per line
  const halfLeft = Math.floor((length - 1) / 2); // 3 for 8
  const halfRight = length - 1 - halfLeft;       // 4 for 8

  // Horizontal pair (two adjacent rows)
  const hRows = [CENTER, CENTER + 1];
  for (const ry of hRows) {
    for (let dx = -halfLeft; dx <= halfRight; dx++) {
      const x = CENTER + dx;
      if (inside(x, ry)) b[ry][x] = 1;
    }
  }

  // Vertical pair (two adjacent columns)
  const vCols = [CENTER, CENTER + 1];
  for (const cx of vCols) {
    for (let dy = -halfLeft; dy <= halfRight; dy++) {
      const y = CENTER + dy;
      if (inside(cx, y)) b[y][cx] = 1;
    }
  }
  return b;
}

// Axes (dx, dy)
const DIRS = [
  [1, 0],  // 0: horizontal
  [0, 1],  // 1: vertical
  [1, 1],  // 2: diag ↘
  [1, -1], // 3: diag ↗
];

// Overlap check: candidate 5‑window shares any cell with an already‑scored window on same axis
function overlapsExisting(existingSegments, cand) {
  if (!existingSegments || existingSegments.length === 0) return false;
  for (const ex of existingSegments) {
    if (ex.axisId !== cand.axisId) continue;
    const exCells = ex.cells || [];
    for (const c of cand.cells) {
      for (const ec of exCells) {
        if (ec.x === c.x && ec.y === c.y) return true;
      }
    }
  }
  return false;
}

// Compute windows created by placing at (x,y). Returns up to TWO windows per axis (left‑heavy + right‑heavy)
function linesCreatedIfPlaced(board, x, y, existingSegments = []) {
  if (!inside(x, y) || board[y][x] !== 0) return { count: 0, segs: [] };

  board[y][x] = 1; // temp place
  const segs = [];

  const pushIfUnique = (cand) => {
    if (overlapsExisting(existingSegments, cand)) return; // block overlap with previously scored on same axis
    const key = (s) => `${s.axisId}:${s.x1},${s.y1}->${s.x2},${s.y2}`;
    if (!segs.some((s) => key(s) === key(cand))) segs.push(cand);
  };

  DIRS.forEach(([dx, dy], axisId) => {
    // count contiguous in both directions
    let l = 0; let rx = x - dx, ry = y - dy;
    while (inside(rx, ry) && board[ry][rx] === 1) { l++; rx -= dx; ry -= dy; }

    let r = 0; rx = x + dx; ry = y + dy;
    while (inside(rx, ry) && board[ry][rx] === 1) { r++; rx += dx; ry += dy; }

    const total = l + 1 + r;
    if (total >= 5) {
      // left‑heavy window
      let takeLeftA = Math.min(4, l);
      let takeRightA = 4 - takeLeftA;
      if (takeRightA <= r) {
        const x1 = x - dx * takeLeftA, y1 = y - dy * takeLeftA;
        const x2 = x + dx * takeRightA, y2 = y + dy * takeRightA;
        const cells = Array.from({ length: 5 }, (_, k) => ({ x: x1 + dx * k, y: y1 + dy * k }));
        pushIfUnique({ x1, y1, x2, y2, axisId, cells });
      }
      // right‑heavy window
      let takeRightB = Math.min(4, r);
      let takeLeftB = 4 - takeRightB;
      if (takeLeftB <= l) {
        const x1 = x - dx * takeLeftB, y1 = y - dy * takeLeftB;
        const x2 = x + dx * takeRightB, y2 = y + dy * takeRightB;
        const cells = Array.from({ length: 5 }, (_, k) => ({ x: x1 + dx * k, y: y1 + dy * k }));
        pushIfUnique({ x1, y1, x2, y2, axisId, cells });
      }
    }
  });

  board[y][x] = 0; // undo temp
  return { count: segs.length, segs };
}

function findAnyLegalMove(board, existingSegments = []) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (board[y][x] !== 0) continue;
      const r = linesCreatedIfPlaced(board, x, y, existingSegments);
      if (r.count > 0) return true;
    }
  }
  return false;
}

// ----- Component -----
export default function App() {
  const [board, setBoard] = useState(() => seedInitialCross(makeEmptyBoard()));
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState("Place a dot that completes a five‑dot line.");
  const [segments, setSegments] = useState([]); // {x1,y1,x2,y2,axisId,cells[]}

  // Highscore (persist)
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const s = localStorage.getItem('fdl_highscore');
    return s ? parseInt(s, 10) : 0;
  });
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      if (typeof window !== 'undefined') localStorage.setItem('fdl_highscore', String(score));
    }
  }, [score, highScore]);

  // Dark/Light
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('fdl_dark') === '1';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('fdl_dark', dark ? '1' : '0');
  }, [dark]);

  // Sound
  const [muted, setMuted] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('fdl_muted') === '1';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('fdl_muted', muted ? '1' : '0');
  }, [muted]);
  function playScore(count) {
    if (muted) return;
    try {
      const a = new Audio('/score.mp3');
      a.playbackRate = Math.min(1 + 0.05 * (count - 1), 1.3);
      a.play().catch(() => {});
    } catch {}
  }

  // One‑time reveal
  const [revealUsed, setRevealUsed] = useState(false);
  const [revealedMoves, setRevealedMoves] = useState([]); // {x,y,count}[]

  // Hover preview
  const [hover, setHover] = useState({ x: -1, y: -1, lines: 0 });

  // Flash new segments briefly
  const [flashCount, setFlashCount] = useState(0);

  const legalExists = useMemo(() => findAnyLegalMove(board, segments), [board, segments]);
  useEffect(() => { if (!legalExists) setGameOver(true); }, [legalExists]);

  function handleCellClick(x, y) {
    if (gameOver || board[y][x] !== 0) return;
    const created = linesCreatedIfPlaced(board, x, y, segments);
    if (created.count <= 0) {
      setMessage('Invalid move: either no five‑in‑a‑row, or it overlaps a scored line.');
      return;
    }
    const next = clone(board);
    next[y][x] = 1;
    setBoard(next);
    setScore((s) => s + created.count);
    setMoves((m) => m + 1);
    setSegments((arr) => [...arr, ...created.segs]);
    setFlashCount(created.segs.length);
    playScore(created.count);
    setTimeout(() => setFlashCount(0), 650);
    setMessage(created.count === 1 ? 'Nice! +1 line.' : `Great! +${created.count} lines.`);
  }

  function reset() {
    setBoard(seedInitialCross(makeEmptyBoard()));
    setScore(0);
    setMoves(0);
    setGameOver(false);
    setMessage('Place a dot that completes a five‑dot line.');
    setSegments([]);
    setHover({ x: -1, y: -1, lines: 0 });
    setRevealUsed(false);
    setRevealedMoves([]);
    setFlashCount(0);
  }

  function onHover(x, y) {
    if (board[y][x] !== 0 || gameOver) { setHover({ x, y, lines: 0 }); return; }
    const r = linesCreatedIfPlaced(board, x, y, segments);
    setHover({ x, y, lines: r.count });
  }

  function getAllLegalMoves() {
    const out = [];
    for (let yy = 0; yy < N; yy++) {
      for (let xx = 0; xx < N; xx++) {
        if (board[yy][xx] !== 0) continue;
        const r = linesCreatedIfPlaced(board, xx, yy, segments);
        if (r.count > 0) out.push({ x: xx, y: yy, count: r.count });
      }
    }
    return out;
  }
  function revealOnce() {
    if (revealUsed || gameOver) return;
    const moves = getAllLegalMoves();
    setRevealedMoves(moves);
    setRevealUsed(true);
    setMessage(moves.length ? `Revealed ${moves.length} legal spots.` : 'No legal moves to reveal.');
  }

  function handleSvgClick(evt) {
    if (gameOver) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const mx = evt.clientX - rect.left, my = evt.clientY - rect.top;
    const x = Math.max(0, Math.min(N - 1, Math.floor(mx / CELL)));
    const y = Math.max(0, Math.min(N - 1, Math.floor(my / CELL)));
    handleCellClick(x, y);
  }

  // ----- Self‑tests -----
  useEffect(() => {
    try {
      const b = seedInitialCross(makeEmptyBoard());
      const topY = CENTER - 4;
      const r1 = linesCreatedIfPlaced(b, CENTER, topY, []);
      console.assert(r1.count >= 1, 'Expect legal move above vertical arm');
      const rightX = CENTER + 5;
      const r2 = linesCreatedIfPlaced(b, rightX, CENTER, []);
      console.assert(r2.count >= 1, 'Expect legal move to the right of horizontal arm');
      const r3 = linesCreatedIfPlaced(b, CENTER + 5, CENTER + 5, []);
      console.assert(r3.count === 0, 'Expect illegal move when no five can be formed');
      const d = makeEmptyBoard();
      d[10][10] = 1; d[11][11] = 1; d[12][12] = 1; d[13][13] = 1;
      const r4 = linesCreatedIfPlaced(d, 14, 14, []);
      console.assert(r4.count === 1, 'Expect one diagonal five when adding the 5th dot');
      const t = makeEmptyBoard();
      for (let x = 5; x <= 9; x++) t[8][x] = 1;
      const existing = [{ axisId: 0, cells: Array.from({ length: 5 }, (_, k) => ({ x: 5 + k, y: 8 })) }];
      const r5 = linesCreatedIfPlaced(t, 10, 8, existing);
      console.assert(r5.count === 0, 'Overlapping a scored five should be illegal');
      const s = makeEmptyBoard();
      for (let dx = -4; dx <= -1; dx++) s[10][10 + dx] = 1;
      for (let dx = 1; dx <= 4; dx++) s[10][10 + dx] = 1;
      const r6 = linesCreatedIfPlaced(s, 10, 10, []);
      console.assert(r6.count >= 2, 'Expect two 5‑windows on same axis when both sides have 4');
      console.info('Self‑tests passed: Five‑Dot Lines');
    } catch (e) { console.warn('Self‑tests error:', e); }
  }, []);

  const wrapperCls = dark
    ? "min-h-screen w-full flex items-center justify-center bg-[#0b1020] text-slate-100 p-6"
    : "min-h-screen w-full flex items-center justify-center bg-slate-50 text-slate-900 p-6";

  return (
    <div className={wrapperCls}>
      <div className="max-w-5xl w-full grid grid-cols-1 gap-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Five‑Dot Lines — Solo</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="px-3 py-1 rounded-2xl bg-white/80 text-slate-900 shadow">Score: <b>{score}</b></span>
            <span className="px-3 py-1 rounded-2xl bg-white/80 text-slate-900 shadow">Highscore: <b>{highScore}</b></span>
            <span className="px-3 py-1 rounded-2xl bg-white/80 text-slate-900 shadow">Moves: <b>{moves}</b></span>
            <button onClick={revealOnce} disabled={revealUsed || gameOver} className={`px-3 py-1 rounded-2xl shadow ${revealUsed || gameOver ? 'bg-slate-200 text-slate-500' : 'bg-white'}`}>Show Moves (once)</button>
            <button onClick={() => setMuted(m => !m)} className="px-3 py-1 rounded-2xl shadow bg-white">{muted ? 'Unmute' : 'Mute'}</button>
            <button onClick={() => setDark(d => !d)} className="px-3 py-1 rounded-2xl shadow bg-white">{dark ? 'Light' : 'Dark'}</button>
            <button onClick={reset} className="px-3 py-1 rounded-2xl bg-black text-white shadow">Reset</button>
          </div>
        </header>

        <p className="text-sm text-slate-600 dark:text-slate-200 bg-white/80 dark:bg-white/10 p-3 rounded-xl shadow">{gameOver ? (
          <>Game over — no legal moves remain. Final score: <b>{score}</b>.</>
        ) : (
          <>{message} {hover.lines > 0 && <span className="ml-2 text-emerald-600">(Hover spot would score +{hover.lines})</span>}</>
        )}</p>

        <div className="overflow-auto bg-white/90 dark:bg-white/5 rounded-2xl shadow" style={{ padding: PADDING }}>
          <svg
            width={N * CELL}
            height={N * CELL}
            viewBox={`0 0 ${N * CELL} ${N * CELL}`}
            onClick={handleSvgClick}
          >
            {/* grid */}
            <g>
              {Array.from({ length: N }).map((_, i) => (
                <line key={`h${i}`} x1={0} y1={i * CELL + CELL/2} x2={N * CELL} y2={i * CELL + CELL/2} stroke="#e5e7eb" />
              ))}
              {Array.from({ length: N }).map((_, i) => (
                <line key={`v${i}`} y1={0} x1={i * CELL + CELL/2} y2={N * CELL} x2={i * CELL + CELL/2} stroke="#e5e7eb" />
              ))}
            </g>

            {/* dots & hit areas */}
            {board.map((row, y) => row.map((v, x) => {
              const cx = x * CELL + CELL/2, cy = y * CELL + CELL/2;
              const isHover = hover.x === x && hover.y === y && v === 0 && hover.lines > 0 && !gameOver;
              return (
                <g key={`c${x}-${y}`} transform={`translate(${cx}, ${cy})`}>
                  <rect x={-CELL/2} y={-CELL/2} width={CELL} height={CELL} fill="transparent"
                        onMouseEnter={() => onHover(x, y)}
                        onMouseLeave={() => setHover({ x: -1, y: -1, lines: 0 })}
                        onClick={(e) => { e.stopPropagation(); handleCellClick(x, y); }}
                        style={{ cursor: gameOver ? 'default' : 'pointer' }} />
                  {v === 0 && isHover && (<circle r={9} fill="#10b981" opacity={0.7} />)}
                  {v === 1 && (<circle r={7.5} fill="#ef4444" />)}
                </g>
              );
            }))}

            {/* scoring segments (drawn above dots) */}
            {segments.map((s, i) => (
              <line key={`seg${i}`}
                    x1={s.x1 * CELL + CELL/2}
                    y1={s.y1 * CELL + CELL/2}
                    x2={s.x2 * CELL + CELL/2}
                    y2={s.y2 * CELL + CELL/2}
                    stroke="#111827"
                    strokeWidth={i >= segments.length - flashCount ? 5 : 3}
                    strokeOpacity={i >= segments.length - flashCount ? 0.85 : 1}
                    strokeLinecap="round" />
            ))}

            {/* one‑time revealed legal moves */}
            {revealUsed && revealedMoves.map((m, i) => (
              <g key={`rev${i}`} transform={`translate(${m.x * CELL + CELL/2}, ${m.y * CELL + CELL/2})`}>
                <circle r={7} fill="none" stroke="#2563eb" strokeDasharray="2 2" />
                <text x={0} y={4} fontSize="10" textAnchor="middle" fill="#2563eb">{m.count}</text>
              </g>
            ))}
          </svg>
        </div>

        <section className="text-sm text-slate-700 dark:text-slate-200 leading-6 bg-white/80 dark:bg-white/10 rounded-2xl p-4 shadow">
          <h2 className="font-semibold mb-2">Rules Recap</h2>
          <ul className="list-disc ml-5">
            <li>Place one dot per move on an empty intersection.</li>
            <li>Your placement must create at least one straight line of <b>five</b> consecutive dots that includes the new dot.</li>
            <li>No overlap on the <b>same axis</b> with previously scored fives.</li>
            <li>Up to <b>2 lines per axis per move</b> (two distinct 5‑windows including the new dot). Multiple axes may score.</li>
            <li>The game ends when no legal move exists.</li>
          </ul>
        </section>

        <footer className="text-xs text-slate-500 dark:text-slate-400 text-center pb-2">Prototype — React + SVG. Ready for Tauri/Electron packaging.</footer>
      </div>
    </div>
  );
}