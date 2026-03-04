// Color palette for mixture components.
// Shared by landscape markers and detail-panel chart lines.

export const COMPONENT_COLORS = [
  '#e8a84c', // warm gold (accent)
  '#4c8ce8', // blue
  '#4ce87a', // green
  '#e84c8c', // pink
  '#8c4ce8', // purple
];

export function componentColor(index) {
  return COMPONENT_COLORS[index % COMPONENT_COLORS.length];
}

export function componentColorHex(index) {
  const hex = COMPONENT_COLORS[index % COMPONENT_COLORS.length];
  return parseInt(hex.slice(1), 16);
}
