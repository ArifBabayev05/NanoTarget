/**
 * Actor assessment: fuses server-observed request signals, early page
 * artifacts and recent interaction samples into an explainable judgment.
 *
 * Design rules (from the research):
 *  - `unknown` is a first-class outcome and is never treated as human.
 *  - Evidence is tiered. Only `verified` (cryptographic) and `strong`
 *    (deterministic browser flags) are decisive on their own. `behavioral`
 *    needs a minimum number of actions. `artifact` signals are
 *    implementation-specific and experimental: they never decide alone.
 *  - Experiment labels, room ids, user agents and known product names are
 *    NOT inputs. Nothing here reads them.
 *  - Scores are explanatory indexes, not calibrated probabilities.
 */
import { clickFeatures, judgeClick, type Judgement } from './kinematics.ts';
import { CONTROL_MARKERS, toolInjectedGlobals, type EarlySignal, type InteractionSample, type ServerSignal } from './signals.ts';

export const SIGNAL_VERSION = 'assess-v7';

/**
 * verified   cryptographic operator signature
 * strong     deterministic browser facts (webdriver, untrusted event, focus/click on a hidden document, WebMCP call)
 * control    a known agent tool's *active-control* indicator is present in the page (version-specific, present at load)
 * behavioral repeated synthetic-looking input over ≥3 actions
 * artifact   environment traces: extension installed, agent-app UA, model-context globals, clipboard bridge, focus conflict
 */
export type Tier = 'verified' | 'strong' | 'control' | 'behavioral' | 'artifact';
export type Actor = 'agent_likely' | 'human_like' | 'unknown';

export type ReasonCode =
  | 'VERIFIED_OPERATOR_SIGNATURE'
  | 'SIGNATURE_REPLAY'
  | 'WEBDRIVER_FLAG'
  | 'UNTRUSTED_EVENT'
  | 'WEBMCP_TOOL_INVOKED'
  | 'HIDDEN_DOCUMENT_CLICK'
  | 'SYNTHETIC_FIRST_CLICK'
  | 'FOCUS_WHILE_HIDDEN'
  | 'MAIN_WORLD_READ_BURST'
  | 'MAIN_WORLD_TEXT_EXTRACT'
  | 'PANEL_PAGE_READ'
  | 'SIDE_PANEL_OPENED'
  | 'IDLE_PAGE_SCAN'
  | 'AGENT_TOOL_GLOBALS'
  | 'VISIBILITY_FLICKER'
  | 'RENDER_WHILE_HIDDEN'
  | 'AGENT_CONTROL_MARKER'
  | 'AGENT_ATTACHED_EARLIER'
  | 'HUMAN_VERIFIED_WEBAUTHN'
  | 'AGENT_PAGE_GLOBALS'
  | 'AGENT_EXTENSION_INSTALLED'
  | 'ZERO_PRESSURE_POINTER'
  | 'ATOMIC_CLICKS'
  | 'SINGLE_ATOMIC_CLICK'
  | 'ORGANIC_POINTER'
  | 'HUMAN_KINEMATICS'
  | 'SYNTHETIC_KINEMATICS'
  | 'VARIED_KEY_INTERVALS'
  | 'DOM_MARKER'
  | 'AGENT_APP_BROWSER'
  | 'CLIPBOARD_BRIDGE'
  | 'FOCUS_CONFLICT'
  | 'TOUCH_OR_KEYBOARD_PATH'
  | 'NO_CLIENT_TELEMETRY'
  | 'INSUFFICIENT_ACTIONS'
  | 'INDISTINGUISHABLE';

export type Reason = {
  code: ReasonCode;
  kind: 'agent' | 'human' | 'neutral';
  tier: Tier | null;
  detail: string;
};

export type Assessment = {
  version: string;
  actor: Actor;
  score: number | null;
  tiers: Tier[];
  reasons: Reason[];
  metrics: {
    actions: number;
    atomic: number;
    organic: number;
    untrusted: number;
    keys: number;
    markers: number;
    focusConflicts: number;
    hiddenClicks: number;
    zeroPressure: number;
  };
};

export type AssessInput = {
  server: ServerSignal | null;
  early: EarlySignal | null;
  interactions: InteractionSample[];
  /** the sample attached to the action being decided, if any */
  current: InteractionSample | null;
  /** page-relative ms at which the connection classifier first saw an agent attach to this session; sticky */
  attachedEarlierMs?: number | null;
  /** a WebAuthn user-verified assertion happened recently: a person is present at the authenticator */
  humanVerified?: boolean;
};

/** ≤ 12 ms press with no approach at all: with SDK ≥ v5 `traj` keeps the hand's last approach, so a trackpad tap
 *  on a target the pointer had travelled to is not atomic; a click that appeared out of nowhere is. */
const isAtomic = (c: NonNullable<InteractionSample['click']>) =>
  c.pointer === 'mouse' && c.detail > 0 && c.trusted && c.holdMs !== null && c.holdMs <= 12 && c.moves <= 2 && !(c.traj && c.traj.length >= 5 && c.at && Math.hypot(c.at[0] - c.traj[c.traj.length - 1]![1], c.at[1] - c.traj[c.traj.length - 1]![2]) <= 8);

const isOrganic = (c: NonNullable<InteractionSample['click']>) =>
  c.trusted && c.pointer === 'mouse' && c.holdMs !== null && c.holdMs >= 35 && c.holdMs <= 1600 && c.moves >= 5 && c.path >= 25 && c.travelMs >= 80;

/** Per-click kinematic judgement for mouse clicks that carry a trajectory (SDK v3). */
export function judgeClicks(clicks: NonNullable<InteractionSample['click']>[]): Judgement[] {
  const out: Judgement[] = [];
  let last: { w: number; h: number; at: [number, number] | null } | null = null;
  for (const c of clicks) {
    if (!c.traj || !c.trusted || c.detail === 0 || (c.pointer !== 'mouse' && c.pointer !== 'touch')) { last = null; continue; }
    if (c.pointer === 'touch') {
      // Touch (phones): no approach exists by nature and pressure reads 1 on Android. Hold length is the one press
      // property we can read; without an agent-touch baseline it stays informative-only ('uncertain').
      const flags = ['touch'];
      if (c.holdMs !== null && c.holdMs >= 35 && c.holdMs <= 400) flags.push('touch_press');
      out.push({ verdict: 'uncertain', humanPts: 0, agentPts: 0, flags });
      last = null;
      continue;
    }
    const f = clickFeatures(c.traj, { holdMs: c.holdMs, pressure: c.pressure, pointer: c.pointer, target: c.target ?? null, downMs: c.downMs ?? null, coalesced: c.coalesced ?? 0, at: c.at ?? null });
    // a second click on the same element (same size, or within 3 px of the previous click) without movement
    // is how people press "show" twice or click right after a reload with the mouse already there
    const sameSize = !!(last && c.target && last.w === c.target.w && last.h === c.target.h);
    const samePlace = !!(last && last.at && c.at && Math.hypot(last.at[0] - c.at[0], last.at[1] - c.at[1]) <= 3);
    out.push(judgeClick(f, { repeatTarget: sameSize || samePlace }));
    last = { w: c.target?.w ?? -1, h: c.target?.h ?? -1, at: c.at ?? null };
  }
  return out;
}

export function assess(input: AssessInput): Assessment {
  const recent = input.interactions.slice(-5);
  if (input.current) recent.push(input.current);
  const clicks = recent.flatMap((s) => (s.click ? [s.click] : []));
  const atomic = clicks.filter(isAtomic).length;
  const judgements = judgeClicks(clicks);
  const kinHuman = judgements.filter((j) => j.verdict === 'human').length;
  const kinSynthetic = judgements.filter((j) => j.verdict === 'synthetic').length;
  // With trajectories (SDK ≥ v3) the kinematic judge is the only source of "organic": the legacy count (moves ≥ 5,
  // hold 35–1600 ms) would let a humanised bot with a plausible press through. Without trajectories it still applies.
  const anyTraj = clicks.some((c) => c.traj !== undefined);
  const organic = anyTraj ? kinHuman : clicks.filter(isOrganic).length;
  const untrusted = clicks.filter((c) => !c.trusted).length;
  // Candidate signals found 2026-09-18 with the Claude desktop in-app browser (CDP Input.dispatchMouseEvent):
  // pointerdown arrives with pressure 0 while buttons are pressed, and clicks land on a hidden document.
  const hiddenClicks = clicks.filter((c) => c.hidden === true && c.trusted && c.detail > 0 && c.pointer !== '').length;
  const zeroPressure = clicks.filter((c) => c.pressure === 0 && c.trusted && c.detail > 0 && c.pointer === 'mouse' && c.holdMs !== null).length;
  const keys = recent.reduce((n, s) => n + s.keys, 0);
  const intervals = recent.flatMap((s) => s.keyIntervals).filter((n) => n > 20 && n < 3000);
  const typed = keys >= 5 && intervals.length >= 4 && Math.max(...intervals) - Math.min(...intervals) > 35;
  const webdriver = input.early?.webdriver === true || recent.some((s) => s.webdriver);
  const markers = input.early?.markers ?? [];
  const focusConflicts = input.early?.focusConflict.count ?? 0;

  const reasons: Reason[] = [];
  const tiers = new Set<Tier>();
  let score = 40;
  const appToken = input.server?.environment?.agentAppToken;

  // --- verified tier -------------------------------------------------------
  const sig = input.server?.signature;
  if (sig?.status === 'verified') {
    tiers.add('verified');
    score = 100;
    reasons.push({ code: 'VERIFIED_OPERATOR_SIGNATURE', kind: 'agent', tier: 'verified', detail: `Sorğu ${sig.operator ?? 'operator'} açarı ilə imzalanıb və serverdə təsdiqlənib.` });
  } else if (sig?.status === 'replay') {
    tiers.add('verified');
    score = 100;
    reasons.push({ code: 'SIGNATURE_REPLAY', kind: 'agent', tier: 'verified', detail: 'Təsdiqlənmiş imza qısa müddətdə təkrar istifadə edilib.' });
  }

  // --- strong tier ---------------------------------------------------------
  if (webdriver) {
    tiers.add('strong');
    score = Math.max(score, 90);
    reasons.push({ code: 'WEBDRIVER_FLAG', kind: 'agent', tier: 'strong', detail: 'Brauzer navigator.webdriver ilə avtomatlaşdırma altında olduğunu bildirir.' });
  }
  if (untrusted > 0) {
    tiers.add('strong');
    score = Math.max(score, 80);
    reasons.push({ code: 'UNTRUSTED_EVENT', kind: 'agent', tier: 'strong', detail: `${untrusted} klik proqram tərəfindən yaradılıb (isTrusted=false).` });
  }
  if ((input.early?.webmcpInvocations ?? 0) > 0) {
    tiers.add('strong');
    score = Math.max(score, 85);
    reasons.push({ code: 'WEBMCP_TOOL_INVOKED', kind: 'agent', tier: 'strong', detail: 'Səhifənin WebMCP aləti agent tərəfindən çağırılıb.' });
  }

  if (hiddenClicks > 0) {
    tiers.add('strong');
    score = Math.max(score, 88);
    reasons.push({ code: 'HIDDEN_DOCUMENT_CLICK', kind: 'agent', tier: 'strong', detail: `${hiddenClicks} klik sənəd gizli (visibilityState=hidden) ikən gəlib; insan gizli səhifəyə klikləyə bilməz. İnsan baseline-ı hələ toplanır.` });
  }
  const env = input.early?.environment;
  const fc = input.early?.reading.firstClick;
  const agentApp = !!appToken || !!env?.codexModelContext;
  if (fc && fc.trusted && fc.pointer === 'mouse' && fc.pressure === 0 && fc.moves <= 1 && fc.holdMs !== null && fc.holdMs <= 12 && (fc.hidden === true || agentApp) && hiddenClicks === 0) {
    tiers.add('strong');
    score = Math.max(score, 86);
    reasons.push({ code: 'SYNTHETIC_FIRST_CLICK', kind: 'agent', tier: 'strong', detail: `İlk klik sintetik profildədir: pressure 0, ${fc.moves} hərəkət, ${fc.holdMs} ms${appToken ? `, ${appToken} mühitində` : ''}. Eyni paneldə insan klikləri pressure 0.5 və 40–100 hərəkət verdi.` });
  }
  if (env?.focusWhileHiddenMs != null) {
    tiers.add('strong');
    score = Math.max(score, 86);
    reasons.push({ code: 'FOCUS_WHILE_HIDDEN', kind: 'agent', tier: 'strong', detail: `Sənəd gizli ikən ${env.focusWhileHiddenMs} ms-də document.hasFocus() true idi (focus emulation). Klik olmadan, passiv müşahidə.` });
  }

  const rd = input.early?.reading;
  if (rd && rd.readBursts > 0 && rd.readBurstAnonymous) {
    tiers.add('strong');
    score = Math.max(score, 86);
    reasons.push({ code: 'MAIN_WORLD_READ_BURST', kind: 'agent', tier: 'strong', detail: `Səhifə ${rd.firstReadBurstMs} ms-də <anonymous> skript tərəfindən toplu oxundu (${rd.lastReadBurstReads}+ DOM oxunuşu 250 ms-də). Agentlər klikdən əvvəl səhifəni belə oxuyur.` });
  }
  if (rd && rd.textExtracts > 0) {
    tiers.add('strong');
    score = Math.max(score, 85);
    reasons.push({ code: 'MAIN_WORLD_TEXT_EXTRACT', kind: 'agent', tier: 'strong', detail: `${rd.firstTextExtractMs} ms-də bütün sənədin mətni <anonymous> skript tərəfindən çıxarıldı.` });
  }
  // Reading from an isolated world: the page cannot see the read itself, only its two shadows —
  // a panel that took viewport width, and main-thread work nobody asked for. The pair is control-tier;
  // each alone stays in the artifact tier, because a translator panel and a heavy widget also exist.
  const sf = input.early?.surface;
  if (sf && sf.panelOpenedMs != null && sf.panelClosedMs == null && sf.scans > 0) {
    tiers.add('control');
    score = Math.max(score, 80);
    reasons.push({ code: 'PANEL_PAGE_READ', kind: 'agent', tier: 'control', detail: `Yan panel ${sf.panelOpenedMs} ms-də ${sf.panelWidthPx}px götürdü; ${sf.scanAfterPanelMs ?? '?'} ms sonra səhifəyə toxunulmadan ${sf.longestScanMs} ms-lik əsas-axın işi oldu. Ekstenşn məzmun skripti səhifəni belə oxuyur: oxunuşun özü səhifənin JS dünyasında görünmür.` });
  } else if (sf && sf.panelOpenedMs != null) {
    tiers.add('artifact');
    score = Math.max(score, 45);
    reasons.push({ code: 'SIDE_PANEL_OPENED', kind: 'agent', tier: 'artifact', detail: sf.panelAtLoad ? `Səhifə yüklənəndə yanda ${sf.panelWidthPx}px-lik panel açıq idi. Tərcümə paneli, devtools və brauzer zoom-u da belə görünür; tək başına aktor sübutu deyil.` : `${sf.panelOpenedMs} ms-də yan panel açıldı (innerWidth ${sf.panelWidthPx}px azaldı, outerWidth/dpr sabit). Tərcümə paneli və ya devtools da eynidir; tək başına aktor sübutu deyil.` });
  } else if (sf && sf.scans > 0) {
    tiers.add('artifact');
    score = Math.max(score, 45);
    reasons.push({ code: 'IDLE_PAGE_SCAN', kind: 'agent', tier: 'artifact', detail: `${sf.scans} dəfə ${sf.longestScanMs} ms-lik əsas-axın işi istifadəçi toxunmadan baş verdi. Ağır vidjet də yarada bilər; tək başına aktor sübutu deyil.` });
  }
  const injected = toolInjectedGlobals(input.early?.environment.agentGlobals ?? []);
  if (injected.length) {
    tiers.add('control');
    score = Math.max(score, 88);
    reasons.push({ code: 'AGENT_TOOL_GLOBALS', kind: 'agent', tier: 'control', detail: `Agent aləti səhifəyə ${injected.map((g) => g.name).slice(0, 3).join(', ')} qlobalını yeridib. İnsan istifadəsində yaranmır.` });
  }
  if (rd && rd.visibilityFlickers > 0) {
    // Environment only: a person opening a link inside the Claude pane produced the same flicker (2026-09-20).
    tiers.add('artifact');
    score = Math.max(score, 52);
    reasons.push({ code: 'VISIBILITY_FLICKER', kind: 'agent', tier: 'artifact', detail: `${rd.firstFlickerMs} ms-də sənəd bir kadrlıq görünüb yenidən gizləndi${rd.flickerResize ? ` (${rd.flickerResize})` : ''}. Gizli paneldə yükləmə; insan da yaradır.` });
  }

  // --- control tier: active-control indicators of known agent tools ---------
  const controlMarkers = markers.filter((m) => CONTROL_MARKERS.includes(m.name));
  if (controlMarkers.length) {
    tiers.add('control');
    score = Math.max(score, 82);
    const first = Math.min(...controlMarkers.map((m) => m.atMs));
    reasons.push({ code: 'AGENT_CONTROL_MARKER', kind: 'agent', tier: 'control', detail: `Agent alətinin aktiv idarə göstəricisi səhifədədir (${controlMarkers.map((m) => m.name).join(', ')}), ilk dəfə ${first} ms-də. Versiyaya bağlı, amma yalnız agent idarə edərkən yaranır.` });
  } else if (input.attachedEarlierMs != null) {
    tiers.add('control');
    score = Math.max(score, 80);
    reasons.push({ code: 'AGENT_ATTACHED_EARLIER', kind: 'agent', tier: 'control', detail: `Bu sessiyaya ${Math.round(input.attachedEarlierMs / 100) / 10} s-də agent qoşulmuşdu. Göstərici sonra itsə də, sessiya təmiz sayılmır.` });
  }

  // --- behavioral tier -----------------------------------------------------
  // Training runs 2026-09-22: a person tapping a trackpad produced 2 approach-less 1–3 ms taps (after a page
  // reload) among 4 kinematically human clicks. Programs produce no human clicks at all, so both counters
  // only carry weight when they outnumber the window's kinematic human clicks.
  if (zeroPressure >= 2 && zeroPressure > kinHuman) {
    score = Math.max(score, Math.min(84, 40 + zeroPressure * 12));
    if (recent.length >= 3) tiers.add('behavioral');
    reasons.push({ code: 'ZERO_PRESSURE_POINTER', kind: 'agent', tier: 'behavioral', detail: `${zeroPressure} klikdə düymə basılı ikən pressure=0 gəlib; real siçan 0.5 verir (Pointer Events spesifikasiyası). Sintetik giriş namizədidir.` });
  }
  if (atomic >= 2 && atomic > kinHuman) {
    score = Math.max(score, Math.min(87, 40 + atomic * 13));
    if (recent.length >= 3) tiers.add('behavioral');
    reasons.push({ code: 'ATOMIC_CLICKS', kind: 'agent', tier: 'behavioral', detail: `${atomic} klikdə ≤12 ms basma və demək olar ki, siçan izi yoxdur.` });
  } else if (atomic === 1) {
    score += 12;
    reasons.push({ code: 'SINGLE_ATOMIC_CLICK', kind: 'neutral', tier: null, detail: 'Bir ani klik var; tək klik qərar üçün kifayət etmir.' });
  }
  // --- kinematics (kin-v1): the trajectory that led to each click ----------
  // Synthetic-looking clicks carry weight only while they are not outnumbered two-to-one by kinematically human
  // clicks in the same window: an agent produces no human clicks, a person on a trackpad produces a stray tap.
  const syntheticDominant = kinSynthetic >= 2 && kinSynthetic * 2 > kinHuman;
  if (syntheticDominant || (kinSynthetic === 1 && judgements.length === 1 && judgements[0]!.agentPts >= 5)) {
    tiers.add('behavioral');
    score = Math.max(score, kinSynthetic >= 2 ? 82 : 70);
    const j = judgements.filter((x) => x.verdict === 'synthetic');
    reasons.push({ code: 'SYNTHETIC_KINEMATICS', kind: 'agent', tier: 'behavioral', detail: `${kinSynthetic} klikin kursor trayektoriyası sintetikdir (${[...new Set(j.flatMap((x) => x.flags))].slice(0, 5).join(', ')}). İnsan kursoru əyri, titrəyişli və hədəfə yaxınlaşanda yavaşlayan yol çəkir.` });
  }
  if (kinHuman >= 1) {
    const j = judgements.filter((x) => x.verdict === 'human');
    reasons.push({ code: 'HUMAN_KINEMATICS', kind: 'human', tier: null, detail: `${kinHuman} klikin trayektoriyası insan profilindədir (${[...new Set(j.flatMap((x) => x.flags))].slice(0, 5).join(', ')}).` });
  }
  const noStrong = !tiers.has('verified') && !tiers.has('strong') && !tiers.has('control');
  if (organic >= 2) {
    if (noStrong) score -= Math.min(30, organic * 10);
    reasons.push({ code: 'ORGANIC_POINTER', kind: 'human', tier: null, detail: `${organic} klikdə mərhələli siçan hərəkəti və normal basma müddəti var.` });
  }
  if (typed) {
    if (noStrong) score -= 15;
    reasons.push({ code: 'VARIED_KEY_INTERVALS', kind: 'human', tier: null, detail: 'Müxtəlif fasilələrlə klaviatura girişi müşahidə olunur.' });
  }
  // Behavioral human verdict. Decided here, before the artifact tier, because environment traces
  // (agent app window, page globals, hidden rendering) describe the browser, not the hand on the mouse:
  // they must never raise a kinematically human session back above the human threshold.
  // Two kinematically human clicks are enough (kin-v1); without trajectories the legacy rule needs three actions.
  // One click is enough when its trajectory is unambiguous (≥ 8 human points, 0 agent points: the sandbox
  // dataset puts every human click at 6–10/0–1 and every agent click at 0–2/6–8). This is what lets a person
  // inside an AI browser window see their data on the first click instead of after a passkey.
  // Later clicks on the same button without moving are uncertain by construction; they must not undo it.
  // A single click that unlocks a whole session must clear a higher bar than accumulated rule points:
  // a smooth synthesiser (CDP `Input.dispatchMouseEvent` with forged `force`, a Bezier path, protocol-level
  // reads) can earn curved_path + tremor + decelerates + held_press without ever moving like a hand. When the
  // learned model is present its agreement is required for the pure-rule branch too — measured 2026-09-23 on
  // 366 human clicks: 0 lost single-click unlocks, and it drops synthesiser single-click unlocks. The model's
  // own confident verdict (second branch) already carries this.
  const strongClick = (j: Judgement) => j.verdict === 'human' && ((j.humanPts >= 8 && j.agentPts <= 1 && (j.p === undefined || j.flags.includes('model_human'))) || (j.flags.includes('model_human') && j.humanPts >= 7 && j.agentPts <= 3));
  const strongHumanFirst = judgements.some(strongClick) && judgements.every((j) => j.verdict !== 'synthetic' && (j.agentPts <= 1 || j.flags.includes('model_human')));
  // Safari/Force Touch trackpads report pressure 0 on light taps (training run t-q4jdqo3c, 2026-09-22): a single
  // zero-pressure click therefore only vetoes the legacy (trajectory-less) rule, never kinematic evidence.
  // Likewise one "atomic" tap (≤ 12 ms, no movement — a light trackpad tap) cannot cancel two kinematically human
  // clicks in the same window; two or more atomic clicks are agent evidence on their own (ATOMIC_CLICKS).
  const behaviorallyHuman = noStrong && ((kinHuman >= 2 && kinHuman >= 2 * kinSynthetic && atomic <= kinHuman) || (kinSynthetic === 0 && atomic === 0 && (strongHumanFirst || (recent.length >= 3 && organic >= 2 && zeroPressure === 0))));
  if (behaviorallyHuman) score = Math.min(score, 22);
  const floor = (n: number) => { if (!behaviorallyHuman) score = Math.max(score, n); };
  if (recent.some((s) => s.click?.pointer === 'touch' || s.click?.detail === 0) && noStrong) {
    reasons.push({ code: 'TOUCH_OR_KEYBOARD_PATH', kind: 'neutral', tier: null, detail: 'Touch və ya klaviatura yolu var; siçan qaydaları ona tətbiq edilmir.' });
  }

  // --- artifact tier (experimental) ---------------------------------------
  const traceMarkers = markers.filter((m) => !CONTROL_MARKERS.includes(m.name));
  if (traceMarkers.length) {
    tiers.add('artifact');
    floor(60);
    reasons.push({ code: 'DOM_MARKER', kind: 'agent', tier: 'artifact', detail: `Səhifədə agent alətinin izi: ${traceMarkers.map((m) => m.name).join(', ')}. Keçmiş və ya passiv iz; aktiv idarə sübutu deyil.` });
  }
  const envGlobals = (env?.agentGlobals ?? []).filter((g) => !injected.some((i) => i.name === g));
  if (envGlobals.length) {
    tiers.add('artifact');
    floor(62);
    reasons.push({ code: 'AGENT_PAGE_GLOBALS', kind: 'agent', tier: 'artifact', detail: `Səhifə qlobalında agent alətinə aid adlar: ${envGlobals.slice(0, 4).join(', ')}. Mühit izidir.` });
  }
  if (rd?.renderWhileHiddenMs != null) {
    tiers.add('artifact');
    floor(55);
    reasons.push({ code: 'RENDER_WHILE_HIDDEN', kind: 'agent', tier: 'artifact', detail: `Sənəd gizli ikən ${rd.renderWhileHiddenMs} ms-də render olunmağa davam edirdi. Adi brauzer gizli tabı çəkmir; insan baseline-ı hələ yoxdur.` });
  }
  // 2026-09-20: three human sessions on the live site were masked because Claude/Codex extensions were merely
  // installed in the person's Chrome. Installation is a fact about the browser, not about who is clicking:
  // it is reported for the record and carries no tier and no score.
  if (env?.extensionsInstalled.length) {
    reasons.push({ code: 'AGENT_EXTENSION_INSTALLED', kind: 'neutral', tier: null, detail: `Brauzerdə agent ekstenşnı quraşdırılıb: ${env.extensionsInstalled.join(', ')}. Quraşdırılma aktiv idarə demək deyil; qərara təsir etmir.` });
  }
  if (appToken) {
    tiers.add('artifact');
    floor(55);
    reasons.push({ code: 'AGENT_APP_BROWSER', kind: 'agent', tier: 'artifact', detail: `Sorğu ${appToken} tokenli daxili brauzerdən gəlir${input.server?.environment?.clientHints === false ? ' və Sec-CH-UA başlıqları yoxdur' : ''}. Mühit izidir: həmin paneldə insan da klikləyə bilər.` });
  }
  if (input.early?.environment.clipboardBridge) {
    tiers.add('artifact');
    floor(55);
    reasons.push({ code: 'CLIPBOARD_BRIDGE', kind: 'agent', tier: 'artifact', detail: 'Səhifə qlobalında browser-use clipboard körpüsü var. Avtomatlaşdırma köməkçisinin izidir; aktiv idarəni sübut etmir.' });
  }
  // 2026-09-18: a human session inside the Claude desktop pane produced 61 conflicts — focus
  // emulation there applies to every tab regardless of who clicks. Inside an agent-app browser
  // the signal says nothing new, so it is only reported outside such environments.
  if (focusConflicts >= 3 && !appToken) {
    tiers.add('artifact');
    floor(50);
    reasons.push({ code: 'FOCUS_CONFLICT', kind: 'agent', tier: 'artifact', detail: `${focusConflicts} dəfə iki tab eyni anda fokusda göründü (focus emulation). Çox-tab tələb edir; insan baseline-ında da görünə bilər.` });
  }

  // --- verdict -------------------------------------------------------------
  let actor: Actor = 'unknown';
  if (tiers.has('verified') || tiers.has('strong') || tiers.has('control') || tiers.has('behavioral')) actor = 'agent_likely';
  else if (behaviorallyHuman) actor = 'human_like';
  // A recent WebAuthn user-verified assertion is the one thing in this file that proves a person:
  // the authenticator itself checked biometrics/PIN. It overrides everything except a live
  // operator signature (a signed agent request is still an agent request).
  if (input.humanVerified && !tiers.has('verified')) {
    actor = 'human_like';
    score = Math.min(score, 10);
    reasons.unshift({ code: 'HUMAN_VERIFIED_WEBAUTHN', kind: 'human', tier: null, detail: 'Passkey / Touch ID ilə istifadəçi təsdiqi (user verification) serverdə doğrulandı. Sessiya insan tərəfindən geri alınıb.' });
  }

  if (!input.early && !recent.length) {
    reasons.push({ code: 'NO_CLIENT_TELEMETRY', kind: 'neutral', tier: null, detail: 'Brauzer SDK-sından siqnal gəlməyib. Bu, insan sübutu deyil.' });
  } else if (recent.length < 3 && actor === 'unknown') {
    reasons.push({ code: 'INSUFFICIENT_ACTIONS', kind: 'neutral', tier: null, detail: `Davranış pəncərəsində ${recent.length} əməliyyat var; ən azı 3 lazımdır.` });
  } else if (actor === 'unknown' && !reasons.some((r) => r.kind !== 'neutral')) {
    reasons.push({ code: 'INDISTINGUISHABLE', kind: 'neutral', tier: null, detail: 'Siqnallar insanı və agenti ayırmaq üçün kifayət etmir.' });
  }

  const hasEvidence = recent.length > 0 || webdriver || !!sig || markers.length > 0 || !!env?.agentGlobals.length || !!env?.extensionsInstalled.length || env?.focusWhileHiddenMs != null || !!rd?.readBursts || !!rd?.visibilityFlickers || rd?.renderWhileHiddenMs != null;
  return {
    version: SIGNAL_VERSION,
    actor,
    score: hasEvidence ? Math.max(0, Math.min(100, Math.round(score))) : null,
    tiers: [...tiers],
    reasons: reasons.slice(0, 6),
    metrics: { actions: recent.length, atomic, organic, untrusted, keys, markers: markers.length, focusConflicts, hiddenClicks, zeroPressure },
  };
}
