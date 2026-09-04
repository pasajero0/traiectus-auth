/**
 * Pixel art as one `<rect>` per pixel: sharp at any size, no asset pipeline, no dependency.
 * The map below *is* the picture — edit the strings, not coordinates. A dot is sky.
 */
const PIXELS = [
  '....................',
  '..oo................',
  '..oo................',
  '........sm..........',
  '.......ssm..........',
  '......sssm..........',
  '.....ssssm.....dd...',
  '....sssssm.....dd...',
  '.........m.....dd...',
  '...hhhhhhhhh..ddddd.',
  '....hhhhhhh...d...d.',
  '~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~',
]

const SKY = '#bcdcef'

/** Fixed colours, not theme tokens: a picture keeps its own palette in either theme. */
const PALETTE: Record<string, string> = {
  o: '#f2b705', // sun
  s: '#fdfcf9', // sail
  m: '#6b4a32', // mast
  h: '#a8442f', // hull
  d: '#8a5a3b', // dock
  '~': '#3d7ea6', // water
}

export function HarborArt() {
  const width = PIXELS[0]?.length ?? 0

  return (
    <svg
      className="art"
      viewBox={`0 0 ${width} ${PIXELS.length}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pixel art: a sailboat moored beside a dock"
    >
      <rect width={width} height={PIXELS.length} fill={SKY} />
      {PIXELS.map((row, y) =>
        [...row].map((pixel, x) => {
          const fill = PALETTE[pixel]
          return fill ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} /> : null
        }),
      )}
    </svg>
  )
}
