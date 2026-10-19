export type Frame = { x: number; y: number; w: number; h: number };

export type Fill = { color: string; transparency?: number };
export type Stroke = { color: string; width?: number };
export type TextStyle = {
  font_family?: string;
  font_size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'mid' | 'bottom';
  break_line?: boolean;
};

export type TextElement = {
  type: 'text';
  id: string;
  frame: Frame;
  text: string;
  style?: TextStyle;
  z_index?: number;
};

export type ShapeElement = {
  type: 'shape';
  id: string;
  frame: Frame;
  shape?: 'rect' | 'roundRect' | 'ellipse' | 'line';
  fill?: Fill | null;
  stroke?: Stroke | null;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  z_index?: number;
};

export type ImageElement = {
  type: 'image';
  id: string;
  frame: Frame;
  src: string;
  fit?: 'contain' | 'cover' | 'stretch';
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  z_index?: number;
};

export type SlideElement = TextElement | ShapeElement | ImageElement;

export type SlideIR = {
  id: string;
  width: number;
  height: number;
  background: Fill;
  elements: SlideElement[];
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type DeckIR = {
  deck_id: string;
  title: string;
  version: number;
  slides: SlideIR[];
  theme?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type Project = { id: string; name: string; status: string };
export type Deck = { id: string; project_id: string; title: string; status: string; ir: DeckIR };
export type Job = {
  id: string;
  deck_id: string;
  status: string;
  current_step?: string | null;
  error?: string | null;
  output_path?: string | null;
};

