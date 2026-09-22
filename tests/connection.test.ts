import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConnection } from '../server/connection.ts';
import { EMPTY_READING, type EarlySignal, type ServerSignal } from '../server/signals.ts';

const early = (over: Partial<EarlySignal> = {}): EarlySignal => ({
  startedMs: 0, observedMs: 1000, webdriver: false, firstInteractionMs: null, dataDomMs: null, markers: [],
  environment: { codexModelContext: false, modelContextApi: false, clipboardBridge: false, clipboardBridgeAtMs: null, agentGlobals: [], extensionsInstalled: [], focusWhileHiddenMs: null },
  focusConflict: { count: 0, firstAtMs: null, peers: 0 }, webmcpInvocations: 0, reading: { ...EMPTY_READING }, ...over,
});
const env = (over: Partial<EarlySignal['environment']>): EarlySignal => { const e = early(); return { ...e, environment: { ...e.environment, ...over } }; };
const server = (over: Partial<ServerSignal> = {}): ServerSignal => ({ signature: { status: 'absent', reason: '', operator: null, present: { signature: false, signatureInput: false, signatureAgent: false } }, secFetch: { site: null, mode: null, dest: null, user: null }, uaMajor: 153, environment: { agentAppToken: null, clientHints: true }, checkedMs: 1, ...over });

test('nothing observed → no_indication (not "human")', () => {
  const c = classifyConnection(server(), early());
  assert.equal(c.state, 'no_indication');
  assert.equal(c.atMs, null);
});

test('Claude in Chrome control markers → agent_attached at the marker time', () => {
  const c = classifyConnection(server(), early({ markers: [{ name: 'claude-stop', atMs: 26113 }, { name: 'claude-cursor', atMs: 26113 }, { name: 'claude-styles', atMs: 26113 }] }));
  assert.equal(c.state, 'agent_attached');
  assert.equal(c.atMs, 26113);
  assert.deepEqual(c.tools, ['claude-chrome']);
  assert.ok(c.evidence.some((e) => e.code === 'AGENT_CONTROL_MARKER'));
});

test('Codex overlay → agent_attached; favicon badge alone → environment', () => {
  assert.equal(classifyConnection(server(), early({ markers: [{ name: 'codex-overlay', atMs: 215 }] })).state, 'agent_attached');
  const badge = classifyConnection(server(), early({ markers: [{ name: 'codex-badge', atMs: 300 }] }));
  assert.equal(badge.state, 'agent_environment');
  assert.deepEqual(badge.tools, ['codex-chrome']);
});

test('Claude desktop pane: UA token alone is agent_environment, even for a person', () => {
  const c = classifyConnection(server({ environment: { agentAppToken: 'Claude/2.2553.1', clientHints: false } }), early());
  assert.equal(c.state, 'agent_environment');
  assert.equal(c.atMs, 0);
  assert.deepEqual(c.tools, ['claude-app']);
});

test('Codex in-app browser: model-context global alone is agent_environment', () => {
  const c = classifyConnection(server({ uaMajor: 152 }), env({ codexModelContext: true, modelContextApi: true, agentGlobals: ['__codexWebMcpModelContext'] }));
  assert.equal(c.state, 'agent_environment');
  assert.deepEqual(c.tools, ['codex-app']);
  assert.ok(!c.evidence.some((e) => e.code === 'AGENT_PAGE_GLOBALS'), 'model-context global is not double counted');
});

test('installed extensions → agent_environment with tool names', () => {
  const c = classifyConnection(server(), env({ extensionsInstalled: ['claude-chrome', 'codex-chrome'] }));
  assert.equal(c.state, 'agent_environment');
  assert.deepEqual(c.tools.sort(), ['claude-chrome', 'codex-chrome']);
});

test('focus while hidden or webdriver → agent_attached without any click', () => {
  assert.equal(classifyConnection(server(), env({ focusWhileHiddenMs: 900 })).state, 'agent_attached');
  assert.equal(classifyConnection(server(), early({ webdriver: true })).state, 'agent_attached');
});

test('verified signature → signed_agent, dominates everything', () => {
  const c = classifyConnection(server({ signature: { status: 'verified', reason: 'ok', operator: 'https://chatgpt.com', present: { signature: true, signatureInput: true, signatureAgent: true } } }), early({ markers: [{ name: 'claude-stop', atMs: 5 }] }));
  assert.equal(c.state, 'signed_agent');
  assert.deepEqual(c.tools, ['https://chatgpt.com']);
});

const reading = (over: Partial<EarlySignal['reading']>): EarlySignal => { const e = early(); return { ...e, reading: { ...e.reading, ...over } }; };
const claudePane = () => server({ uaMajor: 152, environment: { agentAppToken: 'Claude/2.2553.1', clientHints: false } });

test('Claude pane: whole-document text extraction by an evaluated script → agent_attached, no click', () => {
  const c = classifyConnection(claudePane(), reading({ loadedHidden: true, textExtracts: 4, firstTextExtractMs: 3156 }));
  assert.equal(c.state, 'agent_attached');
  assert.equal(c.atMs, 3156);
  assert.ok(c.evidence.some((e) => e.code === 'MAIN_WORLD_TEXT_EXTRACT'));
  assert.ok(c.tools.includes('claude-app'));
});

test('Claude pane: DOM read burst + accessibility-tree globals → agent_attached with tool name', () => {
  const e = reading({ readBursts: 1, firstReadBurstMs: 3158, lastReadBurstReads: 150, readBurstAnonymous: true });
  e.environment.agentGlobals = ['__claudeElementMap', '__claudeElementReverseMap', '__claudeRefCounter', '__generateAccessibilityTree'];
  const c = classifyConnection(claudePane(), e);
  assert.equal(c.state, 'agent_attached');
  assert.ok(c.evidence.some((x) => x.code === 'MAIN_WORLD_READ_BURST'));
  assert.ok(c.evidence.some((x) => x.code === 'AGENT_TOOL_GLOBALS'));
  assert.ok(c.tools.includes('claude-tools'));
  assert.ok(!c.evidence.some((x) => x.code === 'AGENT_PAGE_GLOBALS'), 'tool-injected globals are not double counted as environment');
});

test('a read burst that is NOT anonymous (page/framework code) is ignored', () => {
  const c = classifyConnection(server(), reading({ readBursts: 3, firstReadBurstMs: 500, lastReadBurstReads: 150, readBurstAnonymous: false }));
  assert.equal(c.state, 'no_indication');
});

test('Claude pane: synthetic first click (pressure 0, no travel, ≤12 ms) → agent_attached at that click', () => {
  const c = classifyConnection(claudePane(), reading({ firstClick: { atMs: 10411, trusted: true, pointer: 'mouse', holdMs: 1, moves: 0, pressure: 0, hidden: true } }));
  assert.equal(c.state, 'agent_attached');
  assert.equal(c.atMs, 10411);
  assert.ok(c.evidence.some((e) => e.code === 'SYNTHETIC_FIRST_CLICK'));
});

test('Claude pane: a human first click (pressure 0.5, pointer travel) stays agent_environment', () => {
  const c = classifyConnection(claudePane(), reading({ firstClick: { atMs: 5074, trusted: true, pointer: 'mouse', holdMs: 116, moves: 65, pressure: 0.5, hidden: false } }));
  assert.equal(c.state, 'agent_environment');
});

test('plain Chrome: a zero-pressure first click on a visible document is not decisive alone', () => {
  const c = classifyConnection(server(), reading({ firstClick: { atMs: 900, trusted: true, pointer: 'mouse', holdMs: 3, moves: 0, pressure: 0, hidden: false } }));
  assert.equal(c.state, 'no_indication');
});

test('render-while-hidden and loaded-hidden are environment only', () => {
  const c = classifyConnection(server(), reading({ loadedHidden: true, renderWhileHiddenMs: 484 }));
  assert.equal(c.state, 'agent_environment');
  assert.ok(c.evidence.some((e) => e.code === 'RENDER_WHILE_HIDDEN'));
});

test('environment evidence is kept alongside attached evidence', () => {
  const c = classifyConnection(server(), env({ extensionsInstalled: ['claude-chrome'], focusWhileHiddenMs: 400 }));
  assert.equal(c.state, 'agent_attached');
  assert.ok(c.evidence.some((e) => e.code === 'AGENT_EXTENSION_INSTALLED'));
});
