import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const editors = Object.freeze({
  slides: 'claude-slides',
  design: 'claude-design',
  'design-system': 'claude-design-system',
  dashboard: 'claude-dashboard',
  motion: 'claude-motion',
  whiteboard: 'claude-whiteboard',
});

export const plugins = [
  ['baoyu-slides', 'Slides', ['claude-slides']],
  ['baoyu-canvas', 'Canvas', ['claude-design']],
  ['baoyu-design-system', 'Design System', ['claude-design-system']],
  ['baoyu-dashboard', 'Dashboard', ['claude-dashboard']],
  ['baoyu-motion', 'Motion', ['claude-motion', 'motion-director', 'dataviz']],
  ['baoyu-whiteboard', 'Whiteboard', ['claude-whiteboard']],
  ['baoyu-dataviz', 'Dataviz', ['dataviz']],
];
