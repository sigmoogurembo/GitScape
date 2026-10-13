import { analyzeFiles } from './analyze.mjs';

// A fictional, self-contained repository. No files or history are fetched from the network.
export async function demoRepository() {
  const inputs = [];
  const phases = new Map();
  function add(filePath, content, phase = 1) {
    inputs.push({ path: filePath, content: content.trim() + '\n' });
    phases.set(filePath, phase);
  }
  function json(filePath, value, phase = 1) { add(filePath, JSON.stringify(value, null, 2), phase); }

  json('package.json', {
    name: 'harbor-board', version: '0.8.0', private: false, type: 'module',
    description: 'A fictional open-source project board for the GitScape demo',
    scripts: { dev: 'vite', build: 'tsc && vite build', test: 'vitest run', lint: 'eslint src' },
    devDependencies: { typescript: '^5.7.0', vite: '^6.0.0', vitest: '^3.0.0', eslint: '^9.0.0' },
  });
  json('tsconfig.json', {
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, noUncheckedIndexedAccess: true, baseUrl: '.', paths: { '@/*': ['src/*'] },
      lib: ['ES2022', 'DOM'], noEmit: true }, include: ['src', 'tests'],
  });
  add('vite.config.ts', `import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});`);
  add('index.html', `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0d1726" />
    <title>Harbor — a calmer project board</title>
  </head>
  <body>
    <div id="app" aria-live="polite"></div>
    <script type="module" src="/src/app/bootstrap.ts"></script>
  </body>
</html>`);
  add('README.md', `# Harbor Board

Harbor is a fictional open-source project used to demonstrate GitScape.
Its files and commit history are generated locally, not taken from a real repository.

## Product

A small project board with offline editing, keyboard navigation, and activity history.
Each board contains ordered columns. Issues belong to one column and can carry labels.
The browser stores pending edits, then the sync queue sends them when the network returns.

## Development

Install dependencies with npm install.
Start the development server with npm run dev.
Run the test suite with npm test.

## Layout

- app: routing and startup
- components: small accessible view functions
- features: board, issue, search and activity screens
- lib: domain types and reusable helpers
- services: API, persistence and synchronization
- store: observable application state
- styles: shared tokens and responsive layouts

## Principles

Keep edits reversible. Preserve keyboard focus. Explain synchronization state.
Favor a small explicit data model over hidden background work.

## License

MIT. This demo is illustrative source, not a deployed application.`);
  add('LICENSE', `MIT License

Copyright (c) 2026 Harbor Demo Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`);

  add('src/lib/types.ts', `export type IssueId = string;
export type BoardId = string;
export type ColumnId = string;
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface Member {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Issue {
  id: IssueId;
  boardId: BoardId;
  columnId: ColumnId;
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  labels: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: ColumnId;
  boardId: BoardId;
  title: string;
  position: number;
  limit: number | null;
}

export interface Board {
  id: BoardId;
  title: string;
  description: string;
  columns: Column[];
  members: Member[];
  labels: Label[];
}

export interface Activity {
  id: string;
  issueId: IssueId;
  actorId: string;
  kind: 'created' | 'moved' | 'edited' | 'assigned';
  summary: string;
  timestamp: string;
}

export interface PendingEdit {
  id: string;
  issueId: IssueId;
  patch: Partial<Issue>;
  queuedAt: string;
  attempts: number;
}

export interface AppState {
  boards: Board[];
  issues: Issue[];
  activity: Activity[];
  activeBoardId: BoardId | null;
  selectedIssueId: IssueId | null;
  online: boolean;
  pendingEdits: PendingEdit[];
}`, 2);
  add('src/lib/ids.ts', `const PREFIX = 'harbor';
let sequence = 0;

export function createId(scope: string): string {
  sequence += 1;
  return [PREFIX, scope, Date.now().toString(36), sequence.toString(36)].join('_');
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX + '_');
}

export function resetIdSequence(): void {
  sequence = 0;
}`, 2);
  add('src/lib/dates.ts', `const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

export function isoNow(): string {
  return new Date().toISOString();
}

export function relativeTime(value: string, now = Date.now()): string {
  const delta = new Date(value).getTime() - now;
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

export function shortDate(value: string): string {
  return absolute.format(new Date(value));
}

export function isOverdue(dueAt: string | null, now = Date.now()): boolean {
  return dueAt !== null && new Date(dueAt).getTime() < now;
}`, 2);
  add('src/lib/events.ts', `export type Listener<T> = (value: T) => void;

export function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();

  function subscribe(listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit(value: T): void {
    for (const listener of [...listeners]) listener(value);
  }

  function clear(): void {
    listeners.clear();
  }

  return { subscribe, emit, clear };
}`, 2);
  add('src/lib/storage.ts', `const NAMESPACE = 'harbor:v1:';

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(NAMESPACE + key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  localStorage.removeItem(NAMESPACE + key);
}`, 2);
  add('src/lib/format.ts', `import type { Priority } from './types.js';

const entities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => entities[char] ?? char);
}

export function initials(name: string): string {
  return name.split(/\\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function priorityLabel(priority: Priority): string {
  return priority[0].toUpperCase() + priority.slice(1);
}

export function plural(count: number, word: string): string {
  return count + ' ' + word + (count === 1 ? '' : 's');
}`, 2);
  add('src/lib/order.ts', `import type { Issue } from './types.js';

export function orderedIssues(issues: Issue[], columnId: string): Issue[] {
  return issues.filter(issue => issue.columnId === columnId)
    .sort((left, right) => left.position - right.position);
}

export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return (after ?? 0) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

export function normalizePositions(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => a.position - b.position)
    .map((issue, index) => ({ ...issue, position: (index + 1) * 1024 }));
}`, 2);
  add('src/lib/guards.ts', `import type { Issue, Priority } from './types.js';

const priorities: Priority[] = ['low', 'normal', 'high', 'urgent'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIssue(value: unknown): value is Issue {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.title === 'string' &&
    typeof value.boardId === 'string' && typeof value.columnId === 'string' &&
    typeof value.position === 'number' && Number.isFinite(value.position) &&
    priorities.includes(value.priority as Priority) && Array.isArray(value.labels);
}

export function nonEmpty(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(label + ' is required');
  return result;
}`, 2);

  const uiComponents = [
    ['Button', 'button', 'Action', ['format'], 'type="button"'],
    ['Badge', 'span', 'Label', ['format'], 'role="status"'],
    ['Avatar', 'span', 'Member', ['format', 'types'], 'aria-label="Team member"'],
    ['EmptyState', 'section', 'Nothing here yet', ['format'], 'role="status"'],
    ['Spinner', 'span', 'Loading', ['format'], 'aria-busy="true"'],
    ['Toast', 'aside', 'Notification', ['format', 'events'], 'role="status"'],
  ];
  for (const [name, tag, label, imports, attributes] of uiComponents) {
    const deps = imports.map(item => item === 'types' ?
      `import type { Member } from '@/lib/types.js';` :
      item === 'events' ? `import { createEmitter } from '@/lib/events.js';` :
      `import { escapeHtml } from '@/lib/format.js';`).join('\n');
    const extra = name === 'Toast' ? `\nexport const toastEvents = createEmitter<string>();\n` : '';
    add(`src/components/${name}.ts`, `${deps}

export interface ${name}Props {
  label: string;
  className?: string;
  disabled?: boolean;
}
${extra}
export function ${name}(props: ${name}Props): string {
  const label = escapeHtml(props.label || '${label}');
  const className = escapeHtml(props.className || '${name.toLowerCase()}');
  const disabled = props.disabled ? ' disabled' : '';
  return '<${tag} class="' + className + '" ${attributes}' + disabled + '>' + label + '</${tag}>';
}`, 3);
  }
  add('src/components/Dialog.ts', `import { Button } from './Button.js';
import { escapeHtml } from '@/lib/format.js';

export interface DialogProps {
  id: string;
  title: string;
  content: string;
  confirmLabel?: string;
}

export function Dialog(props: DialogProps): string {
  const titleId = escapeHtml(props.id) + '-title';
  return '<dialog id="' + escapeHtml(props.id) + '" aria-labelledby="' + titleId + '">' +
    '<header><h2 id="' + titleId + '">' + escapeHtml(props.title) + '</h2></header>' +
    '<div class="dialog-body">' + props.content + '</div>' +
    '<footer>' + Button({ label: 'Cancel' }) +
    Button({ label: props.confirmLabel || 'Save', className: 'button primary' }) + '</footer></dialog>';
}

export function openDialog(id: string): void {
  const dialog = document.getElementById(id);
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
}`, 3);
  add('src/components/Navbar.ts', `import { Avatar } from './Avatar.js';
import { Button } from './Button.js';
import { escapeHtml } from '@/lib/format.js';
import type { Board } from '@/lib/types.js';

export function Navbar(board: Board): string {
  const members = board.members.map(member => Avatar({ label: member.initials })).join('');
  return '<nav class="navbar" aria-label="Workspace">' +
    '<a class="brand" href="#/">Harbor</a>' +
    '<span class="board-name">' + escapeHtml(board.title) + '</span>' +
    '<div class="members">' + members + '</div>' +
    Button({ label: 'New issue', className: 'button primary' }) + '</nav>';
}`, 3);
  add('src/components/IssueCard.ts', `import { Badge } from './Badge.js';
import { Avatar } from './Avatar.js';
import { escapeHtml, priorityLabel } from '@/lib/format.js';
import type { Issue, Member, Label } from '@/lib/types.js';

export function IssueCard(issue: Issue, members: Member[], labels: Label[]): string {
  const assignee = members.find(member => member.id === issue.assigneeId);
  const selectedLabels = labels.filter(label => issue.labels.includes(label.id));
  const badges = selectedLabels.map(label => Badge({ label: label.name })).join('');
  const avatar = assignee ? Avatar({ label: assignee.initials }) : '';

  return '<article class="issue-card" tabindex="0" data-issue="' + escapeHtml(issue.id) + '">' +
    '<span class="issue-id">' + escapeHtml(issue.id) + '</span>' +
    '<h3>' + escapeHtml(issue.title) + '</h3>' +
    '<div class="issue-labels">' + badges + '</div>' +
    '<footer><span>' + priorityLabel(issue.priority) + '</span>' + avatar + '</footer></article>';
}

export function focusIssue(id: string): void {
  const card = [...document.querySelectorAll<HTMLElement>('[data-issue]')]
    .find(element => element.dataset.issue === id);
  card?.focus();
}`, 3);
  add('src/components/Column.ts', `import { IssueCard } from './IssueCard.js';
import { EmptyState } from './EmptyState.js';
import { escapeHtml, plural } from '@/lib/format.js';
import { orderedIssues } from '@/lib/order.js';
import type { Board, Column as ColumnModel, Issue } from '@/lib/types.js';

export function Column(column: ColumnModel, board: Board, issues: Issue[]): string {
  const ordered = orderedIssues(issues, column.id);
  const content = ordered.length ? ordered.map(issue => IssueCard(issue, board.members, board.labels)).join('') :
    EmptyState({ label: 'Drag an issue here' });
  const overLimit = column.limit !== null && ordered.length > column.limit;

  return '<section class="column" data-column="' + escapeHtml(column.id) + '">' +
    '<header><h2>' + escapeHtml(column.title) + '</h2><span class="count' +
    (overLimit ? ' warning' : '') + '">' + plural(ordered.length, 'issue') + '</span></header>' +
    '<div class="column-issues">' + content + '</div></section>';
}`, 3);

  add('src/services/http.ts', `export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function request<T>(route: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + route, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new HttpError(response.status, 'Request failed: ' + route);
  return response.json() as Promise<T>;
}

export function isRetryable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500 || error.status === 429;
}`, 4);
  add('src/services/boards.ts', `import { request } from './http.js';
import { readStorage, writeStorage } from '@/lib/storage.js';
import type { Board } from '@/lib/types.js';

export async function fetchBoards(): Promise<Board[]> {
  try {
    const boards = await request<Board[]>('/boards');
    writeStorage('boards', boards);
    return boards;
  } catch {
    return readStorage<Board[]>('boards', []);
  }
}

export async function renameBoard(id: string, title: string): Promise<Board> {
  return request<Board>('/boards/' + encodeURIComponent(id), {
    method: 'PATCH', body: JSON.stringify({ title }),
  });
}`, 4);
  add('src/services/issues.ts', `import { request } from './http.js';
import { isIssue } from '@/lib/guards.js';
import { readStorage, writeStorage } from '@/lib/storage.js';
import type { Issue } from '@/lib/types.js';

export async function fetchIssues(boardId: string): Promise<Issue[]> {
  const key = 'issues:' + boardId;
  try {
    const payload = await request<unknown[]>('/boards/' + encodeURIComponent(boardId) + '/issues');
    const issues = payload.filter(isIssue);
    writeStorage(key, issues);
    return issues;
  } catch {
    return readStorage<unknown[]>(key, []).filter(isIssue);
  }
}

export async function updateIssue(id: string, patch: Partial<Issue>): Promise<Issue> {
  return request<Issue>('/issues/' + encodeURIComponent(id), {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}

export async function deleteIssue(id: string): Promise<void> {
  await request('/issues/' + encodeURIComponent(id), { method: 'DELETE' });
}`, 4);
  add('src/services/sync.ts', `import { updateIssue } from './issues.js';
import { isRetryable } from './http.js';
import { readStorage, writeStorage } from '@/lib/storage.js';
import { createEmitter } from '@/lib/events.js';
import { createId } from '@/lib/ids.js';
import { isoNow } from '@/lib/dates.js';
import type { Issue, PendingEdit } from '@/lib/types.js';

let queue = readStorage<PendingEdit[]>('pending-edits', []);
let flushing = false;
export const syncEvents = createEmitter<PendingEdit[]>();

function persist(): void {
  writeStorage('pending-edits', queue);
  syncEvents.emit([...queue]);
}

export function enqueueEdit(issueId: string, patch: Partial<Issue>): PendingEdit {
  const edit: PendingEdit = {
    id: createId('edit'), issueId, patch, queuedAt: isoNow(), attempts: 0,
  };
  queue.push(edit);
  persist();
  return edit;
}

export async function flushEdits(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    while (queue.length && navigator.onLine) {
      const next = queue[0];
      if (!next) break;
      try {
        await updateIssue(next.issueId, next.patch);
        queue.shift();
      } catch (error) {
        next.attempts += 1;
        if (!isRetryable(error)) queue.shift();
        else break;
      }
      persist();
    }
  } finally {
    flushing = false;
    persist();
  }
}

export function pendingEdits(): PendingEdit[] {
  return [...queue];
}

export function discardEdit(id: string): void {
  queue = queue.filter(edit => edit.id !== id);
  persist();
}`, 4);
  add('src/services/telemetry.ts', `import { isoNow } from '@/lib/dates.js';

interface LocalEvent { name: string; timestamp: string; detail: Record<string, string>; }
const events: LocalEvent[] = [];

// Diagnostics remain local; Harbor does not send behavioral data to third parties.
export function recordEvent(name: string, detail: Record<string, string> = {}): void {
  events.push({ name, timestamp: isoNow(), detail });
  if (events.length > 100) events.shift();
}

export function diagnosticEvents(): LocalEvent[] {
  return structuredClone(events);
}`, 4);
  add('src/services/network.ts', `import { createEmitter } from '@/lib/events.js';
import { flushEdits } from './sync.js';

export const networkEvents = createEmitter<boolean>();

export function watchNetwork(): () => void {
  const online = () => { networkEvents.emit(true); void flushEdits(); };
  const offline = () => networkEvents.emit(false);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}`, 4);

  add('src/store/index.ts', `export { boardStore } from './boardStore.js';
export { issueStore } from './issueStore.js';
export { activityStore } from './activityStore.js';
export { uiStore } from './uiStore.js';`, 5);
  add('src/store/boardStore.ts', `import { createEmitter } from '@/lib/events.js';
import { fetchBoards, renameBoard } from '@/services/boards.js';
import { readStorage, writeStorage } from '@/lib/storage.js';
import { nonEmpty } from '@/lib/guards.js';
import type { Board } from '@/lib/types.js';

let boards: Board[] = [];
let activeId = readStorage<string | null>('active-board', null);
const events = createEmitter<Board | null>();

function active(): Board | null {
  return boards.find(board => board.id === activeId) ?? boards[0] ?? null;
}

function notify(): void {
  writeStorage('active-board', activeId);
  events.emit(active());
}

async function load(): Promise<void> {
  boards = await fetchBoards();
  if (!boards.some(board => board.id === activeId)) activeId = boards[0]?.id ?? null;
  notify();
}

function select(id: string): void {
  if (!boards.some(board => board.id === id)) return;
  activeId = id;
  notify();
}

async function rename(id: string, title: string): Promise<void> {
  const replacement = await renameBoard(id, nonEmpty(title, 'Board title'));
  boards = boards.map(board => board.id === id ? replacement : board);
  notify();
}

export const boardStore = { load, select, rename, active,
  all: () => [...boards], subscribe: events.subscribe };
`, 5);
  add('src/store/issueStore.ts', `import { createEmitter } from '@/lib/events.js';
import { createId } from '@/lib/ids.js';
import { isoNow } from '@/lib/dates.js';
import { positionBetween, orderedIssues } from '@/lib/order.js';
import { fetchIssues } from '@/services/issues.js';
import { enqueueEdit, flushEdits } from '@/services/sync.js';
import { recordActivity } from './activityStore.js';
import { nonEmpty } from '@/lib/guards.js';
import type { Issue, Priority } from '@/lib/types.js';

let issues: Issue[] = [];
const events = createEmitter<Issue[]>();

function notify(): void {
  events.emit([...issues]);
}

async function load(boardId: string): Promise<void> {
  issues = await fetchIssues(boardId);
  notify();
}

function find(id: string): Issue | null {
  return issues.find(issue => issue.id === id) ?? null;
}

function create(boardId: string, columnId: string, title: string): Issue {
  const column = orderedIssues(issues, columnId);
  const timestamp = isoNow();
  const issue: Issue = {
    id: createId('issue'), boardId, columnId, title: nonEmpty(title, 'Title'),
    description: '', priority: 'normal', assigneeId: null, labels: [],
    position: positionBetween(column.at(-1)?.position ?? null, null),
    createdAt: timestamp, updatedAt: timestamp,
  };
  issues.push(issue);
  enqueueEdit(issue.id, issue);
  recordActivity(issue.id, 'created', 'Created ' + issue.title);
  notify();
  void flushEdits();
  return issue;
}

function patch(id: string, changes: Partial<Issue>): void {
  const issue = find(id);
  if (!issue) return;
  const replacement = { ...issue, ...changes, id: issue.id, updatedAt: isoNow() };
  issues = issues.map(item => item.id === id ? replacement : item);
  enqueueEdit(id, changes);
  notify();
  void flushEdits();
}

function move(id: string, columnId: string, before: number | null, after: number | null): void {
  patch(id, { columnId, position: positionBetween(before, after) });
  recordActivity(id, 'moved', 'Moved to ' + columnId);
}

function assign(id: string, assigneeId: string | null): void {
  patch(id, { assigneeId });
  recordActivity(id, 'assigned', assigneeId ? 'Assigned to ' + assigneeId : 'Removed assignee');
}

function setPriority(id: string, priority: Priority): void {
  patch(id, { priority });
}

function remove(id: string): void {
  issues = issues.filter(issue => issue.id !== id);
  notify();
}

export const issueStore = { load, find, create, patch, move, assign, setPriority, remove,
  all: () => [...issues], subscribe: events.subscribe };
`, 5);
  add('src/store/activityStore.ts', `import { createEmitter } from '@/lib/events.js';
import { createId } from '@/lib/ids.js';
import { isoNow } from '@/lib/dates.js';
import { readStorage, writeStorage } from '@/lib/storage.js';
import type { Activity } from '@/lib/types.js';

let activity = readStorage<Activity[]>('activity', []);
const events = createEmitter<Activity[]>();

export function recordActivity(issueId: string, kind: Activity['kind'], summary: string): void {
  activity.unshift({ id: createId('activity'), issueId, actorId: 'current-user',
    kind, summary, timestamp: isoNow() });
  activity = activity.slice(0, 200);
  writeStorage('activity', activity);
  events.emit([...activity]);
}

export const activityStore = {
  all: () => [...activity],
  forIssue: (id: string) => activity.filter(item => item.issueId === id),
  subscribe: events.subscribe,
};`, 5);
  add('src/store/uiStore.ts', `import { createEmitter } from '@/lib/events.js';
import { readStorage, writeStorage } from '@/lib/storage.js';

interface UiState { selectedIssueId: string | null; query: string; theme: 'light' | 'dark'; }
let state: UiState = { selectedIssueId: null, query: '', theme: readStorage('theme', 'dark') };
const events = createEmitter<UiState>();

function update(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  writeStorage('theme', state.theme);
  events.emit({ ...state });
}

export const uiStore = {
  get: () => ({ ...state }), update,
  openIssue: (id: string) => update({ selectedIssueId: id }),
  closeIssue: () => update({ selectedIssueId: null }),
  search: (query: string) => update({ query }),
  subscribe: events.subscribe,
};`, 5);

  add('src/features/BoardView.ts', `import { Column } from '@/components/Column.js';
import { EmptyState } from '@/components/EmptyState.js';
import { boardStore, issueStore } from '@/store';
import { filterIssues } from './IssueFilter.js';
import { uiStore } from '@/store/uiStore.js';

export function BoardView(): string {
  const board = boardStore.active();
  if (!board) return EmptyState({ label: 'Create your first board' });
  const issues = filterIssues(issueStore.all(), { query: uiStore.get().query });
  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  return '<main class="board" aria-label="Project board">' +
    columns.map(column => Column(column, board, issues)).join('') + '</main>';
}

export function bindBoardActions(root: HTMLElement): () => void {
  const click = (event: MouseEvent) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-issue]');
    if (card?.dataset.issue) uiStore.openIssue(card.dataset.issue);
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}`, 6);
  add('src/features/BoardDrag.ts', `import { issueStore } from '@/store/issueStore.js';
import { orderedIssues } from '@/lib/order.js';
import { focusIssue } from '@/components/IssueCard.js';

let draggedId: string | null = null;

export function beginDrag(id: string): void {
  draggedId = id;
}

export function dropInColumn(columnId: string): void {
  if (!draggedId) return;
  const issues = orderedIssues(issueStore.all(), columnId).filter(issue => issue.id !== draggedId);
  issueStore.move(draggedId, columnId, issues.at(-1)?.position ?? null, null);
  focusIssue(draggedId);
  draggedId = null;
}

export function cancelDrag(): void {
  draggedId = null;
}`, 6);
  add('src/features/BoardSettings.ts', `import { Dialog } from '@/components/Dialog.js';
import { boardStore } from '@/store/boardStore.js';
import { escapeHtml } from '@/lib/format.js';

export function BoardSettings(): string {
  const board = boardStore.active();
  if (!board) return '';
  return Dialog({ id: 'board-settings', title: 'Board settings',
    content: '<label>Board name<input name="title" value="' + escapeHtml(board.title) + '" /></label>' });
}

export async function saveBoardSettings(title: string): Promise<void> {
  const board = boardStore.active();
  if (board) await boardStore.rename(board.id, title);
}`, 6);
  add('src/features/IssueDetail.ts', `import { Dialog } from '@/components/Dialog.js';
import { Badge } from '@/components/Badge.js';
import { issueStore } from '@/store/issueStore.js';
import { uiStore } from '@/store/uiStore.js';
import { ActivityFeed } from './ActivityFeed.js';
import { escapeHtml, priorityLabel } from '@/lib/format.js';
import { shortDate } from '@/lib/dates.js';

export function IssueDetail(): string {
  const id = uiStore.get().selectedIssueId;
  const issue = id ? issueStore.find(id) : null;
  if (!issue) return '';

  const content = '<div class="issue-detail">' +
    '<label>Title<input name="title" value="' + escapeHtml(issue.title) + '" /></label>' +
    '<label>Description<textarea name="description">' + escapeHtml(issue.description) + '</textarea></label>' +
    '<div class="issue-meta">' + Badge({ label: priorityLabel(issue.priority) }) +
    '<time datetime="' + escapeHtml(issue.createdAt) + '">' + shortDate(issue.createdAt) + '</time></div>' +
    ActivityFeed(issue.id) + '</div>';
  return Dialog({ id: 'issue-detail', title: issue.title, content });
}

export function saveIssueDetail(id: string, title: string, description: string): void {
  issueStore.patch(id, { title: title.trim(), description: description.trim() });
  uiStore.closeIssue();
}`, 7);
  add('src/features/IssueFilter.ts', `import type { Issue, Priority } from '@/lib/types.js';

export interface IssueFilters {
  query?: string;
  priorities?: Priority[];
  assigneeId?: string;
  labels?: string[];
}

export function filterIssues(issues: Issue[], filters: IssueFilters): Issue[] {
  const query = (filters.query ?? '').trim().toLocaleLowerCase();
  return issues.filter(issue => {
    if (query && !(issue.title + ' ' + issue.description).toLocaleLowerCase().includes(query)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(issue.priority)) return false;
    if (filters.assigneeId && issue.assigneeId !== filters.assigneeId) return false;
    if (filters.labels?.length && !filters.labels.every(label => issue.labels.includes(label))) return false;
    return true;
  });
}

export function activeFilterCount(filters: IssueFilters): number {
  return Number(Boolean(filters.query?.trim())) + Number(Boolean(filters.priorities?.length)) +
    Number(Boolean(filters.assigneeId)) + Number(Boolean(filters.labels?.length));
}`, 7);
  add('src/features/ActivityFeed.ts', `import { activityStore } from '@/store/activityStore.js';
import { relativeTime } from '@/lib/dates.js';
import { escapeHtml } from '@/lib/format.js';
import { EmptyState } from '@/components/EmptyState.js';

export function ActivityFeed(issueId?: string): string {
  const activity = issueId ? activityStore.forIssue(issueId) : activityStore.all();
  if (!activity.length) return EmptyState({ label: 'Activity will appear here' });
  return '<ol class="activity-feed">' + activity.map(item =>
    '<li><span>' + escapeHtml(item.summary) + '</span><time datetime="' +
    item.timestamp + '">' + relativeTime(item.timestamp) + '</time></li>').join('') + '</ol>';
}`, 7);
  add('src/features/CommandPalette.ts', `import { Dialog, openDialog } from '@/components/Dialog.js';
import { issueStore } from '@/store/issueStore.js';
import { uiStore } from '@/store/uiStore.js';
import { filterIssues } from './IssueFilter.js';
import { escapeHtml } from '@/lib/format.js';

export function CommandPalette(query = ''): string {
  const issues = filterIssues(issueStore.all(), { query }).slice(0, 8);
  const results = issues.map(issue => '<button data-result="' + escapeHtml(issue.id) + '">' +
    escapeHtml(issue.title) + '</button>').join('');
  return Dialog({ id: 'command-palette', title: 'Jump to an issue',
    content: '<input name="search" type="search" autocomplete="off" />' + results });
}

export function bindCommandShortcut(): () => void {
  const handler = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      openDialog('command-palette');
    }
    if (event.key === 'Escape') uiStore.closeIssue();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}`, 7);
  add('src/features/SyncStatus.ts', `import { Badge } from '@/components/Badge.js';
import { pendingEdits } from '@/services/sync.js';
import { plural } from '@/lib/format.js';

export function SyncStatus(): string {
  const count = pendingEdits().length;
  const label = !navigator.onLine ? 'Offline — edits saved locally' :
    count ? plural(count, 'edit') + ' waiting to sync' : 'All changes saved';
  return Badge({ label, className: count || !navigator.onLine ? 'sync-status pending' : 'sync-status' });
}`, 7);

  add('src/app/config.ts', `export const config = {
  appName: 'Harbor',
  version: '0.8.0',
  maxTitleLength: 140,
  defaultColumnLimit: 12,
  supportedThemes: ['light', 'dark'] as const,
  shortcuts: { commandPalette: 'Mod+K', newIssue: 'C', closeDialog: 'Escape' },
};`, 8);
  add('src/app/routes.ts', `import { boardStore } from '@/store/boardStore.js';
import { uiStore } from '@/store/uiStore.js';
import { recordEvent } from '@/services/telemetry.js';

export function applyRoute(hash = location.hash): void {
  const [, boardId, issueId] = hash.replace(/^#\\/?/, '').split('/');
  if (boardId) boardStore.select(decodeURIComponent(boardId));
  if (issueId) uiStore.openIssue(decodeURIComponent(issueId));
  recordEvent('route', { hash });
}

export function navigate(boardId: string, issueId?: string): void {
  location.hash = '/board/' + encodeURIComponent(boardId) +
    (issueId ? '/' + encodeURIComponent(issueId) : '');
}

export function watchRoutes(): () => void {
  const listener = () => applyRoute();
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}`, 8);
  add('src/app/AppShell.ts', `import { Navbar } from '@/components/Navbar.js';
import { Spinner } from '@/components/Spinner.js';
import { BoardView } from '@/features/BoardView.js';
import { IssueDetail } from '@/features/IssueDetail.js';
import { CommandPalette } from '@/features/CommandPalette.js';
import { BoardSettings } from '@/features/BoardSettings.js';
import { SyncStatus } from '@/features/SyncStatus.js';
import { boardStore } from '@/store';
import { config } from './config.js';

export function AppShell(): string {
  const board = boardStore.active();
  if (!board) return '<div class="loading">' + Spinner({ label: 'Opening ' + config.appName }) + '</div>';
  return '<div class="app-shell">' + Navbar(board) + BoardView() +
    '<footer class="status-bar">' + SyncStatus() + '</footer>' +
    IssueDetail() + BoardSettings() + CommandPalette() + '</div>';
}`, 8);
  add('src/app/bootstrap.ts', `import { AppShell } from './AppShell.js';
import { applyRoute, watchRoutes } from './routes.js';
import { boardStore, issueStore, uiStore } from '@/store';
import { bindBoardActions } from '@/features/BoardView.js';
import { bindCommandShortcut } from '@/features/CommandPalette.js';
import { watchNetwork } from '@/services/network.js';
import { syncEvents } from '@/services/sync.js';
import { recordEvent } from '@/services/telemetry.js';
import '@/styles/reset.css';
import '@/styles/tokens.css';
import '@/styles/layout.css';
import '@/styles/components.css';
import '@/styles/responsive.css';

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Application root is missing');
  let cleanupActions = () => {};

  function render(): void {
    cleanupActions();
    root!.innerHTML = AppShell();
    cleanupActions = bindBoardActions(root!);
  }

  boardStore.subscribe(render);
  issueStore.subscribe(render);
  uiStore.subscribe(render);
  syncEvents.subscribe(render);
  await boardStore.load();
  const board = boardStore.active();
  if (board) await issueStore.load(board.id);
  applyRoute();
  watchRoutes();
  watchNetwork();
  bindCommandShortcut();
  render();
  recordEvent('app-ready');
}

void start();`, 8);

  add('src/styles/reset.css', `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { line-height: 1.5; -webkit-font-smoothing: antialiased; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; }
img, svg { max-width: 100%; display: block; }
h1, h2, h3, p { margin: 0; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}`, 9);
  const tokens = { background: '#0d1726', surface: '#172338', elevated: '#20304a', text: '#eef3fa',
    muted: '#96a6be', border: '#31415b', accent: '#8de0cf', warning: '#ffcb7d', danger: '#ff8a91',
    'radius-sm': '6px', 'radius-md': '12px', 'radius-lg': '20px', 'space-1': '4px', 'space-2': '8px',
    'space-3': '12px', 'space-4': '16px', 'space-6': '24px', 'space-8': '32px' };
  add('src/styles/tokens.css', ':root {\n' + Object.entries(tokens).map(([name, value]) =>
    `  --${name}: ${value};`).join('\n') + '\n  font-family: Inter, system-ui, sans-serif;\n  color-scheme: dark;\n}', 9);
  add('src/styles/layout.css', `body { background: var(--background); color: var(--text); }
.app-shell { min-height: 100vh; display: grid; grid-template-rows: 72px 1fr 40px; }
.navbar { display: flex; align-items: center; gap: var(--space-6); padding: 0 var(--space-8); border-bottom: 1px solid var(--border); }
.brand { font-size: 22px; font-weight: 700; text-decoration: none; }
.board-name { flex: 1; color: var(--muted); }
.members { display: flex; gap: var(--space-1); }
.board { display: flex; align-items: flex-start; gap: var(--space-6); padding: var(--space-8); overflow: auto; }
.column { flex: 0 0 320px; border-radius: var(--radius-lg); background: var(--surface); padding: var(--space-4); }
.column > header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2); }
.column h2 { font-size: 14px; }
.column-issues { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
.status-bar { display: flex; align-items: center; padding: 0 var(--space-8); border-top: 1px solid var(--border); }
.loading { display: grid; place-items: center; min-height: 100vh; }
.dialog-body { padding: var(--space-6); }
.issue-detail { display: grid; gap: var(--space-4); }
.issue-meta { display: flex; align-items: center; gap: var(--space-3); }`, 9);
  const componentRules = {
    '.button': 'border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: var(--radius-sm); padding: 8px 14px;',
    '.button.primary': 'background: var(--accent); color: var(--background); border-color: transparent;',
    '.button:disabled': 'opacity: 0.5;', '.badge': 'padding: 2px 7px; border-radius: 4px; font-size: 11px; background: var(--elevated);',
    '.avatar': 'width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: var(--elevated); font-size: 10px;',
    '.issue-card': 'padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--elevated);',
    '.issue-card:hover': 'border-color: var(--accent);', '.issue-card h3': 'font-size: 14px; margin: 8px 0 12px;',
    '.issue-id': 'color: var(--muted); font-size: 11px;', '.issue-labels': 'display: flex; flex-wrap: wrap; gap: 4px;',
    '.issue-card footer': 'display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 11px;',
    '.count': 'color: var(--muted); font-size: 11px;', '.count.warning': 'color: var(--warning);',
    '.empty-state': 'padding: 28px 12px; color: var(--muted); text-align: center; font-size: 13px;',
    'dialog': 'width: min(560px, calc(100vw - 32px)); padding: 0; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-lg);',
    'dialog::backdrop': 'background: rgb(0 0 0 / 60%); backdrop-filter: blur(4px);',
    'dialog > header, dialog > footer': 'padding: 20px 24px; border-bottom: 1px solid var(--border);',
    'dialog > footer': 'display: flex; justify-content: flex-end; gap: 8px; border-bottom: 0; border-top: 1px solid var(--border);',
    'label': 'display: grid; gap: 6px; font-size: 12px; color: var(--muted);',
    'input, textarea': 'border: 1px solid var(--border); background: var(--background); color: var(--text); padding: 10px; border-radius: var(--radius-sm);',
    '.activity-feed': 'display: grid; gap: 12px; padding: 0; list-style: none;',
    '.activity-feed li': 'display: flex; justify-content: space-between; gap: 12px; font-size: 12px;',
    '.activity-feed time': 'color: var(--muted); white-space: nowrap;', '.sync-status': 'font-size: 11px; color: var(--accent);',
    '.sync-status.pending': 'color: var(--warning);',
  };
  add('src/styles/components.css', Object.entries(componentRules).map(([selector, rules]) =>
    `${selector} {\n${rules.split('; ').filter(Boolean).map(rule => '  ' + rule.replace(/;$/, '') + ';').join('\n')}\n}`).join('\n\n'), 9);
  add('src/styles/responsive.css', `@media (max-width: 800px) {
  .navbar { padding: 0 var(--space-4); gap: var(--space-3); }
  .members { display: none; }
  .board { padding: var(--space-4); gap: var(--space-4); }
  .column { flex-basis: 280px; }
  .status-bar { padding: 0 var(--space-4); }
}

@media (max-width: 480px) {
  .app-shell { grid-template-rows: 64px 1fr 36px; }
  .brand { font-size: 18px; }
  .board-name { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navbar .button { padding: 6px 10px; font-size: 12px; }
  .column { flex-basis: calc(100vw - 48px); }
}

@media (prefers-contrast: more) {
  :root { --border: #91a3bf; --muted: #c2cee0; }
}`, 9);

  const testDefinitions = [
    ['order', 'src/lib/order', 'positionBetween', `expect(positionBetween(1024, 2048)).toBe(1536);\n    expect(positionBetween(null, 1024)).toBe(0);\n    expect(positionBetween(1024, null)).toBe(2048);`],
    ['format', 'src/lib/format', 'escapeHtml', `expect(escapeHtml('<script>')).toBe('&lt;script&gt;');\n    expect(escapeHtml('A & B')).toBe('A &amp; B');\n    expect(escapeHtml('plain text')).toBe('plain text');`],
    ['filter', 'src/features/IssueFilter', 'filterIssues', `expect(filterIssues([], { query: 'hello' })).toEqual([]);\n    expect(filterIssues([], { priorities: ['urgent'] })).toEqual([]);`],
    ['guards', 'src/lib/guards', 'nonEmpty', `expect(nonEmpty('  Harbor  ', 'Title')).toBe('Harbor');\n    expect(() => nonEmpty('  ', 'Title')).toThrow('Title is required');`],
    ['storage', 'src/lib/storage', 'readStorage', `expect(readStorage('missing', [])).toEqual([]);\n    expect(readStorage('missing', 'fallback')).toBe('fallback');`],
  ];
  for (const [name, module, fn, assertions] of testDefinitions) {
    add(`tests/${name}.test.ts`, `import { describe, expect, it } from 'vitest';
import { ${fn} } from '../${module}.js';

describe('${name}', () => {
  it('handles its basic contract', () => {
    ${assertions}
  });
});`, 10);
  }
  add('tests/fixtures.ts', `import type { Issue } from '../src/lib/types.js';

export const sampleIssues: Issue[] = [
${Array.from({ length: 16 }, (_, index) => `  {
    id: 'harbor_issue_${index + 1}', boardId: 'harbor_board_1', columnId: 'column_${index % 3}',
    title: '${['Improve keyboard navigation', 'Add board export', 'Handle offline edits', 'Document sync conflicts'][index % 4]}',
    description: 'Reproduce the behavior and add a focused regression test.',
    priority: '${['normal', 'high', 'low', 'urgent'][index % 4]}', assigneeId: ${index % 2 ? "'member_1'" : 'null'},
    labels: ['label_${index % 3}'], position: ${(index + 1) * 1024},
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-02T12:00:00.000Z',
  },`).join('\n')}
];`, 10);

  add('docs/architecture.md', `# Architecture

Harbor follows an explicit event flow.
The browser dispatches a user action to a store.
The store updates its immutable snapshot and notifies view subscribers.
Edits enter a persistent synchronization queue before the UI reports success.

## Layers

app owns startup and routing.
features coordinates user-facing behavior.
components produces small accessible HTML fragments.
store owns in-memory state and subscriptions.
services communicates with storage and the API.
lib contains domain types and pure functions.

## Import boundaries

Components may import lib but do not initiate network requests.
Features may import stores, services, and components.
Services may import lib but should not import feature screens.
The app assembles the layers and owns subscription cleanup.

## Offline edits

The queue persists before attempting a request.
Retryable failures leave the operation pending.
Permanent validation failures remove the invalid operation and surface feedback.
Reconnect events flush the queue sequentially.

## Rendering

View functions return markup strings with escaped user content.
Event delegation avoids attaching a listener to every issue card.
Focus restoration is required after moving an issue.`, 11);
  add('docs/contributing.md', `# Contributing

Start with a focused issue and describe the intended behavior.
Include keyboard and offline behavior in any user interface change.

## Pull requests

1. Add a regression test for a fixed defect.
2. Run the test suite and TypeScript checks.
3. Capture a screenshot for visual changes.
4. Update the relevant documentation.

## Coding conventions

Prefer explicit functions and named exports.
Keep pure helpers in lib.
Do not store credentials in source or fixtures.
Use the shared HTML escaping function for any user-provided string.
Clean up subscriptions when a view unmounts.`, 11);
  add('docs/accessibility.md', `# Accessibility

Every board interaction should be possible with a keyboard.
Issue cards receive visible focus and expose their title to assistive technology.
Dialogs use the native dialog element and restore focus on dismissal.

## Review checklist

- Labels remain visible at 200 percent zoom.
- Text and interface borders have sufficient contrast.
- Motion respects the reduced-motion preference.
- A moved issue retains keyboard focus.
- Empty states explain the next useful action.
- Sync status is announced without interrupting typing.
- Commands do not capture shortcuts while editing text.

## Testing

Navigate the entire board without a pointer.
Verify the command palette with screen reader browse mode.
Test long titles and translated labels on a narrow display.`, 11);
  add('docs/offline-sync.md', `# Offline synchronization

An edit is represented by an issue identifier, a patch, and a local timestamp.
Each operation receives an id before writing to persistent storage.

## States

Pending: the edit is stored locally.
Sending: one network request is in progress.
Synced: the server confirmed the operation.
Failed: the server rejected the edit permanently.

## Ordering

Send edits in creation order to preserve a user's intent.
Retry a network failure only after the current flush completes.
Keep pending edits visible after a browser restart.

## Limitations

This illustrative client does not implement multi-user conflict resolution.
A real server would require operation ids and idempotent patch processing.
Do not treat a queue removal as proof of successful synchronization.`, 11);
  add('scripts/check-boundaries.mjs', `import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../src/components/', import.meta.url);
const violations = [];
for (const name of await fs.readdir(root)) {
  if (!name.endsWith('.ts')) continue;
  const code = await fs.readFile(new URL(name, root), 'utf8');
  if (code.includes('@/services/')) violations.push(path.join('components', name));
}
if (violations.length) {
  process.stderr.write('Components may not import services: ' + violations.join(', ') + '\n');
  process.exitCode = 1;
}`, 1);
  add('scripts/release.mjs', `import fs from 'node:fs/promises';

const packageUrl = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(await fs.readFile(packageUrl, 'utf8'));
const notesUrl = new URL('../docs/release-notes.md', import.meta.url);
const note = '# Release ' + manifest.version + '\n\nDescribe user-visible changes before publishing.\n';
await fs.writeFile(notesUrl, note, { flag: 'wx' });
process.stdout.write('Prepared local release notes for ' + manifest.version + '\n');`, 1);

  const result = await analyzeFiles(inputs, { name: 'harbor-board · fictional demo', source: 'demo' });
  const milestones = [
    'Initialize Harbor project and contributor tooling',
    'Define domain model and pure utility functions',
    'Build accessible cards, dialogs and board columns',
    'Add cached API services and persistent edit queue',
    'Introduce observable board, issue and UI stores',
    'Connect board rendering, drag ordering and settings',
    'Add issue details, filters and command palette',
    'Wire application shell, routes and startup',
    'Design dark theme and responsive board layouts',
    'Cover utilities with regression tests and fixtures',
    'Document architecture, accessibility and offline behavior',
    'Preserve keyboard focus and improve sync feedback',
  ];
  const modifications = {
    3: ['src/lib/format.ts'],
    4: ['src/lib/types.ts', 'src/lib/storage.ts'],
    5: ['src/services/sync.ts', 'src/lib/types.ts'],
    6: ['src/store/issueStore.ts', 'src/lib/order.ts'],
    7: ['src/store/issueStore.ts', 'src/components/Dialog.ts', 'src/components/IssueCard.ts'],
    8: ['src/store/boardStore.ts', 'src/store/issueStore.ts', 'src/services/sync.ts'],
    9: ['src/components/Column.ts', 'src/components/Navbar.ts'],
    10: ['src/lib/guards.ts', 'src/lib/order.ts', 'src/lib/format.ts'],
    11: ['README.md', 'src/services/sync.ts'],
    12: ['src/features/BoardDrag.ts', 'src/components/IssueCard.ts', 'src/features/SyncStatus.ts',
      'src/services/sync.ts', 'src/store/issueStore.ts', 'src/styles/components.css', 'docs/accessibility.md'],
  };
  result.history = milestones.map((message, index) => {
    const phase = index + 1;
    const files = inputs.filter(input => phases.get(input.path) === phase).map(input => input.path);
    files.push(...(modifications[phase] || []));
    const deleted = phase === 11 ? ['docs/architecture-draft.md'] : [];
    if (phase === 2) files.push('docs/architecture-draft.md');
    files.push(...deleted);
    return {
      hash: (phase.toString(16).padStart(2, '0') + 'a83f5c9e').repeat(4).slice(0, 40),
      date: new Date(Date.UTC(2026, 8, 1 + index * 3, 12)).toISOString(),
      message, files: [...new Set(files)], deleted,
    };
  });
  const byPath = new Map(result.files.map(file => [file.path, file]));
  for (const commit of result.history) {
    for (const filePath of commit.files) {
      const file = byPath.get(filePath);
      if (!file) continue;
      file.commits++;
      file.createdAt ??= commit.date;
      file.lastModified = commit.date;
    }
  }
  result.stats.commits = result.history.length;
  result.warnings.unshift('Fictional demo: source files and 12 commit milestones are generated locally. Timeline previews use current file sizes, not historical snapshots.');
  return result;
}
