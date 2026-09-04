/**
 * Pixel art as one `<rect>` per pixel: sharp at any size, no asset pipeline, no dependency.
 * The map below *is* the picture — edit the strings, not coordinates. A dot is sky.
 */
const PIXELS = [
  '....................',
  '........ll..........',
  '.......lLLl.........',
  '.bb....lLLl....bb...',
  '.......llll.........',
  '........tt..........',
  '.......tttt.........',
  '.......trrt.........',
  '.......tttt.........',
  '......ttrrtt........',
  '......tttttt........',
  '.....tttttttt.......',
  '~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~',
]

const SKY = '#1b2a3a'

/** Fixed colours, not theme tokens: a picture keeps its own palette in either theme. */
const PALETTE: Record<string, string> = {
  l: '#6b4a32', // lamp housing
  L: '#ffd447', // the light itself
  b: '#ffd447', // what it throws
  t: '#e8e6e1', // tower
  r: '#c0453a', // its stripe
  '~': '#274a63', // water at night
}

export function BeaconArt() {
  const width = PIXELS[0]?.length ?? 0

  return (
    <svg
      className="art"
      viewBox={`0 0 ${width} ${PIXELS.length}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pixel art: a lighthouse throwing its light across the water"
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
