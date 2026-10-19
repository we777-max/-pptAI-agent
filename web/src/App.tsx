import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import type { DeckIR, Frame, Job, ShapeElement, SlideElement, SlideIR, TextElement } from './types';
import type { ImageElement } from './types';
import { createAgentSession, createDeck, createProject, sendAgentMessage, streamAgentEvents, updateDeck } from './api';

const PROJECT_STORAGE_KEY = 'ppt-agent-project-id';
const DECK_STORAGE_KEY = 'ppt-agent-local-deck';
const SERVER_PROJECT_STORAGE_KEY = 'ppt-agent-server-project-id';
const HISTORY_STORAGE_KEY = 'ppt-agent-history';

type AgentMessage = { role: 'user' | 'agent'; text: string };
type AgentAttachment = { name: string; size: number; type: string };
type HistoryEntry = { id: string; title: string; deck: DeckIR; savedAt: string };

function makeStarterDeck(): DeckIR {
  return {
    deck_id: `deck-${Date.now()}`,
    title: 'Untitled presentation',
    version: 1,
    slides: [
      {
        id: 'slide-1',
        width: 13.333,
        height: 7.5,
        background: { color: '#F8FAFC' },
        elements: [
          {
            type: 'text',
            id: 'title',
            frame: { x: 1.05, y: 1.2, w: 8.7, h: 0.78 },
            text: '从想法到一页好 PPT',
            style: { font_size: 28, bold: true, color: '#111827', font_family: 'Aptos Display' },
            z_index: 2,
          },
          {
            type: 'text',
            id: 'subtitle',
            frame: { x: 1.08, y: 2.2, w: 7.8, h: 0.55 },
            text: '在画布中编辑内容，再交给 Agent 生成演示文稿',
            style: { font_size: 14, color: '#64748B' },
            z_index: 2,
          },
          {
            type: 'shape',
            id: 'accent',
            shape: 'roundRect',
            frame: { x: 1.08, y: 3.5, w: 3.9, h: 1.6 },
            fill: { color: '#DBEAFE' },
            stroke: { color: '#93C5FD', width: 1 },
            z_index: 1,
          },
        ],
        notes: 'Starter slide created by Deckly.',
      },
    ],
    theme: { primary: '#4F46E5', ink: '#111827' },
  };
}

function makeBlankDeck(): DeckIR {
  const starter = makeStarterDeck();
  return {
    ...starter,
    deck_id: `deck-${Date.now()}`,
    slides: [
      {
        id: 'slide-1',
        width: 13.333,
        height: 7.5,
        background: { color: '#FFFFFF' },
        elements: [],
        notes: 'Blank canvas ready for Agent.',
      },
    ],
  };
}

function makeLocalAgentElements(prompt: string): SlideElement[] {
  const idBase = `agent-${Date.now()}`;
  const title = prompt.length > 32 ? `${prompt.slice(0, 32)}…` : prompt;
  return [
    {
      type: 'text',
      id: `${idBase}-title`,
      frame: { x: 1.05, y: 1.05, w: 10.6, h: 0.82 },
      text: title || 'Agent 生成的演示文稿',
      style: { font_size: 28, bold: true, color: '#111827', font_family: 'Aptos Display' },
      z_index: 3,
    },
    {
      type: 'text',
      id: `${idBase}-body`,
      frame: { x: 1.08, y: 2.15, w: 9.3, h: 0.8 },
      text: 'Agent 已将这页内容渲染到画布，你可以继续拖动、编辑和调整。',
      style: { font_size: 15, color: '#64748B' },
      z_index: 3,
    },
    {
      type: 'shape',
      id: `${idBase}-accent`,
      shape: 'roundRect',
      frame: { x: 1.08, y: 3.35, w: 4.35, h: 1.75 },
      fill: { color: '#DBEAFE' },
      stroke: { color: '#93C5FD', width: 1 },
      z_index: 1,
    },
  ];
}

function loadDeck(): DeckIR {
  try {
    const stored = window.localStorage.getItem(DECK_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DeckIR;
      if (parsed?.slides?.length) return parsed;
    }
  } catch {
    // Ignore malformed or unavailable browser storage and use a fresh deck.
  }
  return makeBlankDeck();
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as HistoryEntry[] : [];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function deckHasElements(deck: DeckIR): boolean {
  return deck.slides.some((item) => item.elements.length > 0);
}

function localProjectId(): string {
  const existing = window.localStorage.getItem(PROJECT_STORAGE_KEY);
  if (existing?.startsWith('local-')) return existing;
  const id = `local-${Date.now().toString(36)}`;
  window.localStorage.setItem(PROJECT_STORAGE_KEY, id);
  return id;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStep(job: Job | null): string {
  if (!job) return '未生成';
  const labels: Record<string, string> = {
    queued: '排队中',
    validating: '检查内容',
    rendering: '渲染 PPT',
    completed: '已完成',
    failed: '失败',
  };
  return labels[job.status] ?? job.current_step ?? job.status;
}

function elementStyle(element: SlideElement, slide: SlideIR): CSSProperties {
  const frame = element.frame;
  const transforms: string[] = [];
  if ('flipX' in element && element.flipX) transforms.push('scaleX(-1)');
  if ('flipY' in element && element.flipY) transforms.push('scaleY(-1)');
  if ('rotation' in element && element.rotation) transforms.push(`rotate(${element.rotation}deg)`);
  return {
    left: `${(frame.x / slide.width) * 100}%`,
    top: `${(frame.y / slide.height) * 100}%`,
    width: `${(frame.w / slide.width) * 100}%`,
    height: `${(frame.h / slide.height) * 100}%`,
    zIndex: element.z_index ?? 0,
    transform: transforms.length ? transforms.join(' ') : undefined,
    transformOrigin: 'center center',
  };
}

function renderElement(element: SlideElement, slide: SlideIR, selected: boolean, onPointerDown: (event: PointerEvent<HTMLDivElement>, element: SlideElement) => void) {
  const baseStyle = elementStyle(element, slide);
  const className = `canvas-element ${selected ? 'is-selected' : ''}`;
  if (element.type === 'text') {
    const style = element.style ?? {};
    return (
      <div
        key={element.id}
        className={`${className} text-element`}
        style={{ ...baseStyle, color: style.color ?? '#111827', textAlign: style.align ?? 'left', fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal', fontSize: `${Math.max(11, (style.font_size ?? 24) * 0.66)}px`, fontFamily: style.font_family ?? 'Aptos' }}
        onPointerDown={(event) => onPointerDown(event, element)}
      >
        {element.text}
      </div>
    );
  }
  if (element.type === 'shape') {
    const fill = element.fill;
    const stroke = element.stroke;
    const shapeStyle: CSSProperties = {
      ...baseStyle,
      background: element.shape === 'line' ? 'transparent' : fill?.color ?? '#E2E8F0',
      opacity: fill ? 1 - (fill.transparency ?? 0) / 100 : 1,
      border: stroke ? `${Math.max(1, stroke.width ?? 1)}px solid ${stroke.color}` : 'none',
      borderRadius: element.shape === 'ellipse' ? '50%' : element.shape === 'roundRect' ? '16px' : '4px',
    };
    if (element.shape === 'line') shapeStyle.borderTop = `${Math.max(1, stroke?.width ?? 2)}px solid ${stroke?.color ?? '#94A3B8'}`;
    return <div key={element.id} className={`${className} shape-element`} style={shapeStyle} onPointerDown={(event) => onPointerDown(event, element)} />;
  }
  return (
    <div key={element.id} className={`${className} image-element`} style={baseStyle} onPointerDown={(event) => onPointerDown(event, element)}>
      <img src={element.src} alt="" draggable={false} style={{ objectFit: element.fit === 'stretch' ? 'fill' : element.fit ?? 'contain' }} />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field compact-field">
      <span>{label}</span>
      <input type="number" step="0.1" value={Number(value.toFixed(2))} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function App() {
  const [deck, setDeck] = useState<DeckIR>(() => loadDeck());
  const [workspaceMode, setWorkspaceMode] = useState<'start' | 'editor'>(() => deckHasElements(loadDeck()) ? 'editor' : 'start');
  const [projectId, setProjectId] = useState<string>(() => localProjectId());
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [selectedSlideId, setSelectedSlideId] = useState('slide-1');
  const [selectedElementId, setSelectedElementId] = useState<string | null>('title');
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [zoom, setZoom] = useState(72);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentAttachment, setAgentAttachment] = useState<AgentAttachment | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    { role: 'agent', text: '你好，我是你的 PPT Agent。告诉我想修改哪一页或哪个元素。' },
  ]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('本地编辑模式 · 自动保存');
  const agentRunRef = useRef(0);
  const dragRef = useRef<{ id: string; startX: number; startY: number; frame: Frame } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const agentAttachmentInputRef = useRef<HTMLInputElement>(null);
  const replaceImageTargetRef = useRef<string | null>(null);
  const serverDeckIdRef = useRef<string | null>(null);
  const agentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
  }, [deck]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 12)));
  }, [history]);

  const slide = useMemo(() => deck.slides.find((item) => item.id === selectedSlideId) ?? deck.slides[0], [deck.slides, selectedSlideId]);
  const selectedElement = slide?.elements.find((item) => item.id === selectedElementId) ?? null;

  function updateDeckTitle(title: string) {
    setDeck((current) => ({ ...current, title }));
  }

  function updateSlide(patch: Partial<SlideIR>) {
    setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === slide.id ? { ...item, ...patch } : item) }));
  }

  function updateElement(id: string, updater: (element: SlideElement) => SlideElement) {
    setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === slide.id ? { ...item, elements: item.elements.map((element) => element.id === id ? updater(element) : element) } : item) }));
  }

  function addText() {
    const element: TextElement = { type: 'text', id: `text-${Date.now()}`, frame: { x: 1.2, y: 3, w: 5.5, h: 0.7 }, text: '双击编辑这段文字', style: { font_size: 18, color: '#334155' }, z_index: 4 };
    updateSlide({ elements: [...slide.elements, element] });
    setSelectedElementId(element.id);
  }

  function addShape() {
    const element: ShapeElement = { type: 'shape', id: `shape-${Date.now()}`, shape: 'roundRect', frame: { x: 6.8, y: 3.2, w: 3.5, h: 1.6 }, fill: { color: '#EEF2FF' }, stroke: { color: '#C7D2FE', width: 1 }, z_index: 1 };
    updateSlide({ elements: [...slide.elements, element] });
    setSelectedElementId(element.id);
  }

  function chooseImage(targetId: string | null = null) {
    replaceImageTargetRef.current = targetId;
    imageInputRef.current?.click();
  }

  function handleAgentAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAgentAttachment({ name: file.name, size: file.size, type: file.type });
    setMessage(`已添加附件：${file.name}`);
  }

  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : null;
      if (!src) {
        setMessage('图片读取失败');
        return;
      }
      const targetId = replaceImageTargetRef.current;
      replaceImageTargetRef.current = null;
      if (targetId) {
        updateElement(targetId, (element) => element.type === 'image' ? { ...element, src } : element);
        setMessage('图片已替换并保存到本地');
        return;
      }
      const element: ImageElement = { type: 'image', id: `image-${Date.now()}`, frame: { x: 2.1, y: 2.4, w: 4.8, h: 2.8 }, src, fit: 'contain', z_index: 3 };
      updateSlide({ elements: [...slide.elements, element] });
      setSelectedElementId(element.id);
      setMessage('图片已插入画布');
    };
    reader.onerror = () => setMessage('图片读取失败');
    reader.readAsDataURL(file);
  }

  function addSlide() {
    const next: SlideIR = { id: `slide-${Date.now()}`, width: 13.333, height: 7.5, background: { color: '#FFFFFF' }, elements: [] };
    setDeck((current) => ({ ...current, slides: [...current.slides, next] }));
    setSelectedSlideId(next.id);
    setSelectedElementId(null);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, element: SlideElement) {
    event.stopPropagation();
    setSelectedElementId(element.id);
    dragRef.current = { id: element.id, startX: event.clientX, startY: event.clientY, frame: { ...element.frame } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !stageRef.current) return;
    const drag = dragRef.current;
    const stageRect = stageRef.current.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / stageRect.width) * slide.width;
    const deltaY = ((event.clientY - drag.startY) / stageRect.height) * slide.height;
    updateElement(drag.id, (element) => ({ ...element, frame: { ...element.frame, x: clamp(drag.frame.x + deltaX, 0, slide.width - drag.frame.w), y: clamp(drag.frame.y + deltaY, 0, slide.height - drag.frame.h) } }));
  }

  function endDrag() {
    dragRef.current = null;
  }

  function scaleSelected(factor: number) {
    if (!selectedElement || (selectedElement.type !== 'image' && selectedElement.type !== 'shape')) return;
    const nextW = clamp(selectedElement.frame.w * factor, 0.25, slide.width);
    const nextH = clamp(selectedElement.frame.h * factor, 0.25, slide.height);
    const nextX = clamp(selectedElement.frame.x - (nextW - selectedElement.frame.w) / 2, 0, slide.width - nextW);
    const nextY = clamp(selectedElement.frame.y - (nextH - selectedElement.frame.h) / 2, 0, slide.height - nextH);
    updateElement(selectedElement.id, (element) => ({ ...element, frame: { x: nextX, y: nextY, w: nextW, h: nextH } }));
  }

  function flipSelected(axis: 'x' | 'y') {
    if (!selectedElement || (selectedElement.type !== 'image' && selectedElement.type !== 'shape')) return;
    updateElement(selectedElement.id, (element) => {
      if (element.type === 'image' || element.type === 'shape') {
        return axis === 'x' ? { ...element, flipX: !element.flipX } : { ...element, flipY: !element.flipY };
      }
      return element;
    });
  }

  function rotateSelected(degrees: number) {
    if (!selectedElement || (selectedElement.type !== 'image' && selectedElement.type !== 'shape')) return;
    updateElement(selectedElement.id, (element) => {
      if (element.type === 'image' || element.type === 'shape') {
        const current = element.rotation ?? 0;
        return { ...element, rotation: (current + degrees + 360) % 360 };
      }
      return element;
    });
  }

  function exportDesign() {
    if (generating) return;
    setGenerating(true);
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${deck.title || 'deck'}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setJob({ id: `local-${Date.now()}`, deck_id: deck.deck_id, status: 'completed', current_step: 'local_export' });
    setMessage('设计稿已下载 · 修改已保存在本地');
    setGenerating(false);
  }

  async function saveCurrentDeck() {
    if (!serverDeckIdRef.current) {
      setMessage('修改已保存在本地画布');
      return;
    }
    try {
      await updateDeck(serverDeckIdRef.current, { title: deck.title, ir: deck });
      setMessage('已同步到后端项目');
    } catch {
      setMessage('后端暂不可用 · 修改仍已保存在本地');
    }
  }

  function newPresentation() {
    agentRunRef.current += 1;
    if (serverDeckIdRef.current) {
      void updateDeck(serverDeckIdRef.current, { title: deck.title, ir: deck }).catch(() => undefined);
    }
    if (deckHasElements(deck)) {
      const archived: HistoryEntry = { id: deck.deck_id, title: deck.title || '未命名演示文稿', deck, savedAt: new Date().toISOString() };
      setHistory((items) => [archived, ...items.filter((item) => item.id !== archived.id)].slice(0, 12));
    }
    const freshDeck = makeBlankDeck();
    setDeck({ ...freshDeck, deck_id: `deck-${Date.now()}` });
    setWorkspaceMode('start');
    setSelectedSlideId('slide-1');
    setSelectedElementId(null);
    setJob(null);
    setAgentBusy(false);
    setAgentPrompt('');
    setAgentAttachment(null);
    setAgentMessages([{ role: 'agent', text: '新的空白画布已准备好。告诉我你想生成什么。' }]);
    setMessage('空白画布已准备好 · 等待 Agent');
    serverDeckIdRef.current = null;
    agentSessionIdRef.current = null;
  }

  function restoreHistory(entry: HistoryEntry) {
    agentRunRef.current += 1;
    setDeck(entry.deck);
    setWorkspaceMode('editor');
    setSelectedSlideId(entry.deck.slides[0]?.id ?? 'slide-1');
    setSelectedElementId(entry.deck.slides[0]?.elements[0]?.id ?? null);
    setJob(null);
    setMessage(`已恢复历史项目：${entry.title}`);
    serverDeckIdRef.current = null;
    agentSessionIdRef.current = null;
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = agentPrompt.trim();
    if ((!prompt && !agentAttachment) || agentBusy) return;
    const attachment = agentAttachment;
    const requestText = prompt || '请根据这个附件生成一份演示文稿';
    const userMessage = attachment ? `${prompt || '请根据附件生成演示文稿'}\n📎 ${attachment.name}` : requestText;
    const targetSlideId = slide.id;
    const runId = agentRunRef.current + 1;
    agentRunRef.current = runId;
    setAgentBusy(true);
    setAgentMessages((messages) => [...messages, { role: 'user', text: userMessage }, { role: 'agent', text: attachment ? `正在读取附件「${attachment.name}」并生成版式…` : '正在分析需求并生成版式…' }]);
    setAgentPrompt('');
    setAgentAttachment(null);
    setMessage('Agent 正在生成画布内容…');

    try {
      let serverProjectId = window.localStorage.getItem(SERVER_PROJECT_STORAGE_KEY);
      if (!serverProjectId) {
        const project = await createProject(deck.title || '未命名项目');
        serverProjectId = project.id;
        window.localStorage.setItem(SERVER_PROJECT_STORAGE_KEY, serverProjectId);
        setProjectId(serverProjectId);
      }
      if (!serverDeckIdRef.current) {
        const created = await createDeck(serverProjectId, deck.title || '未命名演示文稿', deck);
        serverDeckIdRef.current = created.id;
        setDeck(created.ir);
      } else {
        await updateDeck(serverDeckIdRef.current, { title: deck.title, ir: deck });
      }
      const serverDeckId = serverDeckIdRef.current;
      if (!serverDeckId) throw new Error('后端画布未创建');
      if (!agentSessionIdRef.current) {
        const createdSession = await createAgentSession(serverProjectId, serverDeckId);
        agentSessionIdRef.current = createdSession.id;
      }
      const sessionId = agentSessionIdRef.current;
      if (!sessionId) throw new Error('Agent 会话未创建');
      const run = await sendAgentMessage(
        sessionId,
        requestText,
        attachment ? [{ name: attachment.name, size: attachment.size, content_type: attachment.type || 'application/octet-stream' }] : [],
      );
      const completed = await streamAgentEvents(run.id, (event) => {
        if (agentRunRef.current !== runId) return;
        if (event.event_type === 'run.progress') {
          const progress = typeof event.payload.message === 'string' ? event.payload.message : 'Agent 正在处理…';
          setAgentMessages((messages) => messages.length && messages[messages.length - 1].role === 'agent' ? [...messages.slice(0, -1), { role: 'agent', text: progress }] : [...messages, { role: 'agent', text: progress }]);
          setMessage(progress);
        }
        if (event.event_type === 'deck.ir_updated' && event.payload.ir) {
          setDeck(event.payload.ir as DeckIR);
          setWorkspaceMode('editor');
          setSelectedSlideId(targetSlideId);
          setSelectedElementId((event.payload.ir as DeckIR).slides.find((item) => item.id === targetSlideId)?.elements[0]?.id ?? (event.payload.ir as DeckIR).slides[0]?.elements[0]?.id ?? null);
        }
        if (event.event_type === 'run.failed') {
          throw new Error(String(event.payload.error || 'Agent 运行失败'));
        }
      });
      setJob({ id: completed.id, deck_id: completed.deck_id, status: completed.status, current_step: completed.current_step, error: completed.error });
      setWorkspaceMode('editor');
      setAgentMessages((messages) => [...messages, { role: 'agent', text: '生成完成，内容已渲染到画布，现在可以继续编辑。' }]);
      setMessage('Agent 已完成 · 画布内容可编辑');
    } catch (error) {
      // The local fallback keeps the canvas usable when the optional backend is not running.
      const elements = makeLocalAgentElements(requestText);
      setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === targetSlideId ? { ...item, elements, notes: `Generated locally from: ${requestText}${attachment ? `\nAttachment: ${attachment.name}` : ''}` } : item) }));
      setWorkspaceMode('editor');
      setSelectedElementId(elements[0]?.id ?? null);
      setJob({ id: `local-${Date.now()}`, deck_id: deck.deck_id, status: 'completed', current_step: 'local_render' });
      setAgentMessages((messages) => [...messages, { role: 'agent', text: `后端暂不可用，已使用本地演示模式生成。${error instanceof Error ? `（${error.message}）` : ''}` }]);
      setMessage('本地演示模式 · 启动后端后可使用真实 Agent');
    } finally {
      if (agentRunRef.current === runId) setAgentBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">D</div><div><strong>Deckly</strong><span>PPT Agent</span></div></div>
        <button className="new-ppt-button" onClick={newPresentation}><span>＋</span>新建 PPT</button>
        <nav className="main-nav"><button className="nav-item"><span>✦</span>灵感库</button><button className="nav-item"><span>◫</span>品牌资产</button><button className="nav-item"><span>◇</span>技能插件</button></nav>
        <div className="sidebar-label">历史项目</div>
        {history.length === 0 ? <div className="project-card"><span className="project-dot" /><div><strong>Canvas Workspace</strong><small>{projectId ? `ID ${projectId.slice(0, 8)}` : '未连接'}</small></div></div> : history.map((entry) => (
          <button key={entry.id} className="project-card history-project-card" onClick={() => restoreHistory(entry)} title="恢复这个历史项目">
            <span className="project-dot" /><div><strong>{entry.title}</strong><small>{new Date(entry.savedAt).toLocaleString()}</small></div>
          </button>
        ))}
        <div className="sidebar-footer"><span className="avatar">魏</span><div><strong>创作者</strong><small>个人工作区</small></div><span className="more">•••</span></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumbs"><span>画布工作台</span>{workspaceMode === 'editor' && <><b>/</b><input value={deck.title} onChange={(event) => updateDeckTitle(event.target.value)} aria-label="Deck title" /></>}</div>
          {workspaceMode === 'start' ? <div className="top-actions"><span className="local-mode">AI 创作模式</span></div> : <div className="top-actions"><span className={`status-dot ${job?.status === 'completed' ? 'success' : ''}`} /><span className="save-state">{message}</span><span className="local-mode">{serverDeckIdRef.current ? '已连接 Agent' : '本地模式'}</span><button className="ghost-button" onClick={saveCurrentDeck}>保存</button><button className="primary-button" onClick={exportDesign} disabled={generating}>{generating ? '导出中…' : '导出设计稿'}<span>↓</span></button></div>}
        </header>
        <input ref={agentAttachmentInputRef} className="hidden-input" type="file" accept="image/*,.pdf,.ppt,.pptx,.doc,.docx,.txt,.md" onChange={handleAgentAttachmentChange} />

        {workspaceMode === 'start' ? (
          <section className="creation-screen">
            <div className="creation-hero">
              <div className="creation-mark">✦</div>
              <span className="eyebrow">DECKLY PPT AGENT</span>
              <h1>从一个想法开始你的演示文稿</h1>
              <p>告诉我主题、受众和风格，Agent 会生成一份可继续编辑的 PPT。</p>
            </div>
            <form className="creation-composer" onSubmit={submitAgent}>
              {agentAttachment && <div className="attachment-chip"><span>📎</span><span className="attachment-name">{agentAttachment.name}</span><small>{formatFileSize(agentAttachment.size)}</small><button type="button" onClick={() => setAgentAttachment(null)} aria-label="移除附件">×</button></div>}
              <textarea value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="输入你想创作的内容，例如：为 AI 产品做一份 5 页发布会 PPT…" rows={5} aria-label="开始创作" />
              <div className="creation-composer-footer"><div className="composer-tools"><button type="button" className="attachment-button" onClick={() => agentAttachmentInputRef.current?.click()}>📎 上传附件</button><span>{agentBusy ? 'Agent 正在生成…' : '描述主题、页数、风格和受众'}</span></div><button type="submit" disabled={(!agentPrompt.trim() && !agentAttachment) || agentBusy}>{agentBusy ? '生成中…' : '开始生成'} <span>↗</span></button></div>
            </form>
            <div className="creation-suggestions"><span>试试：</span><button type="button" onClick={() => setAgentPrompt('为 AI 产品做一份 5 页发布会 PPT')}>产品发布会</button><button type="button" onClick={() => setAgentPrompt('制作一份简洁的季度业务复盘 PPT')}>季度复盘</button><button type="button" onClick={() => setAgentPrompt('做一份面向投资人的创业项目介绍 PPT')}>项目介绍</button></div>
            {agentBusy && <div className="creation-progress"><span className="progress-dot" />正在分析需求并生成版式，完成后会自动打开画布…</div>}
          </section>
        ) : (
        <div className="editor-layout">
          <section className="slides-panel">
            <div className="panel-heading"><div><span className="eyebrow">STORYBOARD</span><h2>演示文稿</h2></div><button className="icon-button" onClick={addSlide} title="新增页面">＋</button></div>
            <div className="slide-count">{deck.slides.length} 个页面</div>
            <div className="slide-list">
              {deck.slides.map((item, index) => (
                <button key={item.id} className={`slide-card ${item.id === slide.id ? 'selected' : ''}`} onClick={() => { setSelectedSlideId(item.id); setSelectedElementId(item.elements[0]?.id ?? null); }}>
                  <div className="slide-number">{String(index + 1).padStart(2, '0')}</div>
                  <div className="thumbnail" style={{ background: item.background.color }}>
                    {item.elements.map((element) => <div key={element.id} className={`thumb-element ${element.type}`} style={elementStyle(element, item)} />)}
                  </div>
                  <span className="slide-name">{index === 0 ? '封面' : `页面 ${index + 1}`}</span>
                </button>
              ))}
            </div>
            <button className="add-slide-button" onClick={addSlide}>＋ 添加页面</button>
          </section>

          <section className="canvas-panel">
            <div className="canvas-toolbar"><div className="toolbar-group"><button className={`tool-button ${propertiesOpen ? 'active' : ''}`} onClick={() => setPropertiesOpen((value) => !value)} aria-expanded={propertiesOpen}>选择⌄</button></div><div className="zoom-control"><button className="zoom-button" onClick={() => setZoom((value) => clamp(value - 10, 40, 160))} disabled={zoom <= 40} aria-label="缩小画布" title="缩小画布">−</button><button className="zoom-value" onClick={() => setZoom(72)} title="重置为 72%">{zoom}%</button><button className="zoom-button" onClick={() => setZoom((value) => clamp(value + 10, 40, 160))} disabled={zoom >= 160} aria-label="放大画布" title="放大画布">＋</button></div></div>
            <div className="canvas-area">
              <div className="canvas-stage-wrap" style={{ transform: `scale(${zoom / 100})` }}><div className="canvas-stage" ref={stageRef} style={{ background: slide.background.color }} onPointerDown={() => setSelectedElementId(null)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerLeave={endDrag}>
                {slide.elements.slice().sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map((element) => renderElement(element, slide, element.id === selectedElementId, startDrag))}
              </div><div className="canvas-meta"><span>16:9 · {slide.width.toFixed(3)} × {slide.height.toFixed(1)} in</span><span>页面 {deck.slides.findIndex((item) => item.id === slide.id) + 1} / {deck.slides.length}</span></div></div>
            </div>
            <div className="canvas-hint"><span>拖动元素调整位置</span><span>·</span><span>选中后在右侧编辑属性</span></div>
          </section>

          <aside className="agent-panel">
            <div className="agent-panel-header"><div><span className="eyebrow">AI AGENT</span><h2>智能助手</h2></div><span className="agent-local-badge">本地演示</span></div>
            <div className="agent-messages" aria-live="polite">
              {agentMessages.map((message, index) => <div key={`${message.role}-${index}`} className={`agent-message ${message.role}`}><span className="agent-avatar">{message.role === 'agent' ? '✦' : '你'}</span><p>{message.text}</p></div>)}
            </div>
            <form className="agent-composer" onSubmit={submitAgent}>
              {agentAttachment && <div className="attachment-chip"><span>📎</span><span className="attachment-name">{agentAttachment.name}</span><small>{formatFileSize(agentAttachment.size)}</small><button type="button" onClick={() => setAgentAttachment(null)} aria-label="移除附件">×</button></div>}
              <textarea value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="描述你想生成或修改的内容…" rows={4} aria-label="AI 指令" />
              <div className="agent-composer-footer"><div className="composer-tools"><button type="button" className="attachment-button" onClick={() => agentAttachmentInputRef.current?.click()}>📎 上传附件</button><span>{agentBusy ? '正在生成…' : '本地会话'}</span></div><button type="submit" disabled={(!agentPrompt.trim() && !agentAttachment) || agentBusy}>{agentBusy ? '生成中…' : '发送'} <span>↗</span></button></div>
            </form>
            <div className="agent-suggestions"><span>试试：</span><button type="button" onClick={() => setAgentPrompt('把当前页面标题改得更有冲击力')}>优化标题</button><button type="button" onClick={() => setAgentPrompt('为这一页补充一个三点要点区块')}>补充内容</button></div>
          </aside>

          <aside className={`inspector-panel properties-tray ${propertiesOpen ? '' : 'is-hidden'}`}>
            <input ref={imageInputRef} className="hidden-input" type="file" accept="image/*" onChange={handleImageFileChange} />
            <div className="panel-heading"><div><span className="eyebrow">INSPECTOR</span><h2>属性</h2></div><button className="icon-button">•••</button></div>
            <div className="inspector-section insert-section"><div className="section-title">插入</div><div className="insert-actions"><button onClick={addText}>T 文本</button><button onClick={addShape}>◇ 形状</button><button onClick={() => chooseImage()}>▧ 图片</button></div></div>
            {!selectedElement && <div className="empty-inspector"><div className="empty-icon">✦</div><strong>选择一个元素</strong><span>在画布中选择文本、形状或图片，开始编辑它的属性。</span><button className="outline-button" onClick={() => chooseImage()}>插入本地图片</button></div>}
            {selectedElement && <div className="inspector-content">
              {selectedElement.type === 'text' && <div className="inspector-section"><div className="section-title">文本</div><label className="field"><span>内容</span><textarea value={selectedElement.text} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'text' ? { ...item, text: event.target.value } : item)} /></label><div className="field-grid"><NumberField label="字号" value={selectedElement.style?.font_size ?? 24} onChange={(value) => updateElement(selectedElement.id, (item) => item.type === 'text' ? { ...item, style: { ...item.style, font_size: value } } : item)} /><label className="field compact-field"><span>颜色</span><input type="color" value={selectedElement.style?.color ?? '#111827'} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'text' ? { ...item, style: { ...item.style, color: event.target.value } } : item)} /></label></div><div className="segmented"><button className={selectedElement.style?.bold ? 'active' : ''} onClick={() => updateElement(selectedElement.id, (item) => item.type === 'text' ? { ...item, style: { ...item.style, bold: !item.style?.bold } } : item)}>粗体</button><button className={selectedElement.style?.italic ? 'active' : ''} onClick={() => updateElement(selectedElement.id, (item) => item.type === 'text' ? { ...item, style: { ...item.style, italic: !item.style?.italic } } : item)}>斜体</button></div></div>}
              {selectedElement.type === 'shape' && <div className="inspector-section"><div className="section-title">形状</div><label className="field"><span>类型</span><select value={selectedElement.shape ?? 'rect'} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'shape' ? { ...item, shape: event.target.value as ShapeElement['shape'] } : item)}><option value="rect">矩形</option><option value="roundRect">圆角矩形</option><option value="ellipse">椭圆</option><option value="line">线条</option></select></label><div className="field-grid"><label className="field compact-field"><span>填充</span><input type="color" value={selectedElement.fill?.color ?? '#E2E8F0'} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'shape' ? { ...item, fill: { ...item.fill, color: event.target.value } } : item)} /></label><label className="field compact-field"><span>描边</span><input type="color" value={selectedElement.stroke?.color ?? '#94A3B8'} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'shape' ? { ...item, stroke: { ...item.stroke, color: event.target.value } } : item)} /></label></div></div>}
              {selectedElement.type === 'image' && <div className="inspector-section"><div className="section-title">图片</div><button className="outline-button" onClick={() => chooseImage(selectedElement.id)}>替换图片</button><label className="field"><span>适应方式</span><select value={selectedElement.fit ?? 'contain'} onChange={(event) => updateElement(selectedElement.id, (item) => item.type === 'image' ? { ...item, fit: event.target.value as ImageElement['fit'] } : item)}><option value="contain">完整显示</option><option value="cover">铺满裁切</option><option value="stretch">拉伸填充</option></select></label></div>}
              {(selectedElement.type === 'image' || selectedElement.type === 'shape') && <div className="inspector-section"><div className="section-title">变换</div><div className="transform-actions"><button onClick={() => scaleSelected(0.9)}>缩小</button><button onClick={() => scaleSelected(1.1)}>放大</button><button onClick={() => rotateSelected(-15)}>↶ 左转 15°</button><button onClick={() => rotateSelected(15)}>↷ 右转 15°</button><button className={selectedElement.flipX ? 'active' : ''} onClick={() => flipSelected('x')}>水平翻转</button><button className={selectedElement.flipY ? 'active' : ''} onClick={() => flipSelected('y')}>垂直翻转</button></div><div className="transform-angle">当前角度：{selectedElement.rotation ?? 0}° · 水平：{selectedElement.flipX ? '已翻转' : '正常'} · 垂直：{selectedElement.flipY ? '已翻转' : '正常'}</div></div>}
            </div>}
            <div className="inspector-section slide-settings"><div className="section-title">页面背景</div><label className="field compact-field"><span>颜色</span><input type="color" value={slide.background.color} onChange={(event) => updateSlide({ background: { ...slide.background, color: event.target.value } })} /></label></div>
          </aside>
        </div>
        )}
        <footer className="bottom-status"><span className="online-dot" /> 本地编辑模式 · 生成状态：{formatStep(job)}<span className="footer-spacer" /><span>Deckly Canvas v0.1</span></footer>
      </main>
    </div>
  );
}

export default App;

