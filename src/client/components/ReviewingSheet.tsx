/** 1 行ぶんのコード。字下げと長さを変えて、それらしい図面にする */
const LINES = [
  { indent: 0, length: 120 },
  { indent: 12, length: 150 },
  { indent: 24, length: 96 },
  { indent: 24, length: 168 },
  { indent: 12, length: 72 },
  { indent: 0, length: 40 },
];
const ROW = 11;
const TOP = 10;
const CODE_X = 30;
/** 赤入れの △ を付ける行 */
const MARKED_ROW = 3;

/**
 * AI レビュー実行中に出す、コードの図面を読み取っていく様子。
 * 行が順に引かれ、走査線が上から下へ通り、途中で △ の赤入れが押される
 */
export function ReviewingSheet() {
  const height = TOP * 2 + ROW * (LINES.length - 1);
  const marked = LINES[MARKED_ROW];
  const markX = CODE_X + (marked?.indent ?? 0) + (marked?.length ?? 0) + 10;
  const markY = TOP + ROW * MARKED_ROW;

  return (
    <svg className="reviewing-sheet" viewBox={`0 0 240 ${height}`} aria-hidden="true">
      <line className="reviewing-sheet-gutter" x1={22} y1={4} x2={22} y2={height - 4} />
      {LINES.map((line, index) => {
        const y = TOP + ROW * index;
        return (
          <g key={y}>
            <line className="reviewing-sheet-lineno" x1={8} y1={y} x2={16} y2={y} />
            <line
              className="reviewing-sheet-code"
              x1={CODE_X + line.indent}
              y1={y}
              x2={CODE_X + line.indent + line.length}
              y2={y}
              pathLength={1}
              style={{ animationDelay: `${index * 0.28}s` }}
            />
          </g>
        );
      })}
      <path
        className="reviewing-sheet-mark"
        d={`M ${markX} ${markY - 4.5} L ${markX + 5} ${markY + 4} L ${markX - 5} ${markY + 4} Z`}
      />
      <rect className="reviewing-sheet-scan" x={0} y={0} width={240} height={1.5} />
    </svg>
  );
}
