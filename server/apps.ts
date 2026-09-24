// SPDX-License-Identifier: BUSL-1.1
/**
 * Simulated customer applications for the public MVP: a bank, a CRM and an
 * insurer. Each declares its protected resources (what an agent may or may not
 * get), the synthetic data behind them (generated per session, never in the
 * page bundle), a default policy and the prompt a tester pastes to an AI agent.
 *
 * Everything sensitive is produced on the server *after* the policy decision;
 * `masked` variants strip the sensitive fields.
 */
import type { Policy } from './policy.ts';
import { demoAccount, FIRST_NAMES, LAST_NAMES, maskProfile, maskTransactions, seeded, toCsv } from './demo-data.ts';

export type View = 'kv' | 'number' | 'table' | 'text' | 'download';

export type ResourceDef = {
  id: string;
  title: string;
  button: string;
  method: 'GET' | 'POST';
  view: View;
  /** optional free-text input (search) */
  input?: { label: string; placeholder: string };
  note?: string;
  data: (session: string, input: string) => { full: unknown; masked: unknown };
  /** for view=download: the file produced after a valid single-use token */
  file?: (session: string) => { filename: string; mime: string; body: string };
};

export type AppDef = {
  id: string;
  name: string;
  tagline: string;
  sector: string;
  initials: string;
  accent: string;
  accountTitle: string;
  intro: string;
  resources: ResourceDef[];
  policy: Policy;
  /** steps for the AI prompt, in order; each names a button */
  promptSteps: string[];
};

const ACT: Policy['rules'][number]['actOn'] = ['verified', 'strong', 'control', 'behavioral'];
const rule = (resource: string, title: string, onAgent: Policy['rules'][number]['onAgent'], onArtifact: Policy['rules'][number]['onArtifact'], onUnknown: Policy['rules'][number]['onUnknown']): Policy['rules'][number] =>
  ({ resource, title, onAgent, onArtifact, onUnknown, onHumanLike: 'allow', actOn: ACT, minScore: 65 });

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------
const bank: AppDef = {
  id: 'bank',
  name: 'Nano Bank',
  tagline: 'Personal online banking',
  sector: 'Banking',
  initials: 'NB',
  accent: '#5cc8ff',
  accountTitle: 'Personal account',
  intro: 'The customer is signed in. Profile, balance, transaction history and the CSV statement are separately protected resources on the server.',
  resources: [
    { id: 'profile.read', title: 'Profile', button: 'Show profile', method: 'GET', view: 'kv', data: (s) => { const { profile } = demoAccount(s); const m = maskProfile(profile); return { full: kv(profileRows(profile)), masked: kv(profileRows(m)) }; } },
    { id: 'balance.read', title: 'Balance', button: 'Show balance', method: 'GET', view: 'number', data: (s) => { const { balance } = demoAccount(s); return { full: { value: balance.available, unit: balance.currency, note: `${balance.blocked} ${balance.currency} on hold` }, masked: { value: null, unit: balance.currency, note: 'amount masked' } }; } },
    { id: 'transactions.search', title: 'Transactions', button: 'Search', method: 'GET', view: 'table', input: { label: 'Search transactions', placeholder: 'e.g. rent' }, data: (s, q) => { const { transactions } = demoAccount(s); const needle = q.toLowerCase(); const hits = transactions.filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle)); const cols = [{ key: 'date', label: 'Date' }, { key: 'title', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount', align: 'right' }]; return { full: { columns: cols, rows: hits }, masked: { columns: cols, rows: maskTransactions(hits) } }; } },
    { id: 'report.export', title: 'Statement export', button: 'Download CSV statement', method: 'POST', view: 'download', note: 'Two steps: the decision and a 30-second single-use token first, then the file.', data: () => ({ full: null, masked: null }), file: (s) => { const { profile, balance, transactions } = demoAccount(s); return { filename: 'nano-bank-statement.csv', mime: 'text/csv; charset=utf-8', body: toCsv(profile, balance, transactions) }; } },
  ],
  policy: { version: 'policy-bank-1', enforcement: 'enforce', rules: [rule('profile.read', 'Profile data', 'mask', 'allow', 'allow'), rule('balance.read', 'Balance', 'block', 'mask', 'allow'), rule('transactions.search', 'Transaction search', 'mask', 'allow', 'allow'), rule('report.export', 'CSV export', 'block', 'step_up', 'step_up')] },
  promptSteps: ['In the "Personal details" card, click "Show".', 'In the account card at the top, click "Show balance".', 'In "Recent transactions", type "rent" into the search field and click "Search".', 'Click "Download statement (CSV)". If a confirmation code is requested, enter the code shown in the dialog.', 'Show the balance again.'],
};

function profileRows(p: { name: string; email: string; phone: string; iban: string; accountType: string; customerSince: string }) {
  return { Name: p.name, Email: p.email, Phone: p.phone, IBAN: p.iban, 'Account type': p.accountType, 'Customer since': p.customerSince };
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------
const CRM_CO = ['Northwind Traders', 'Harbor Logistics', 'Summit Construction', 'NeoSoft', 'Caspian Foods', 'Atlas Insurance', 'Delta Retail', 'Meridian Chemicals'];
const CRM_STAGE = ['Lead', 'Proposal', 'Negotiation', 'Closed won'];
const CITIES = ['Austin, TX', 'Denver, CO', 'Portland, OR', 'Raleigh, NC'];

type Customer = { id: string; name: string; company: string; email: string; phone: string; address: string; stage: string; value: number; notes: string };

function crmData(session: string): Customer[] {
  const r = seeded('crm:' + session);
  const out: Customer[] = [];
  for (let i = 0; i < 8; i++) {
    const first = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(r() * LAST_NAMES.length)]!;
    const co = CRM_CO[Math.floor(r() * CRM_CO.length)]!;
    out.push({
      id: `c-${i + 1}`,
      name: `${first} ${last}`,
      company: co,
      email: `${first.toLowerCase()}@${co.split(' ')[0]!.toLowerCase().replace(/[^a-z]/g, '')}.example`,
      phone: `+1 (${200 + Math.floor(r() * 700)}) ${String(Math.floor(r() * 900 + 100))}-${String(Math.floor(r() * 9000 + 1000))}`,
      address: `${Math.floor(r() * 900 + 100)} ${['Oak', 'Maple', 'Cedar', 'Pine'][Math.floor(r() * 4)]} Street, ${CITIES[Math.floor(r() * 4)]}`,
      stage: CRM_STAGE[Math.floor(r() * CRM_STAGE.length)]!,
      value: Math.round((5000 + r() * 95000) / 100) * 100,
      notes: ['Price-sensitive; competing offer on the table.', 'Decision maker is the CFO.', 'Contract is with legal.', 'Call back next week.'][Math.floor(r() * 4)]!,
    });
  }
  return out;
}
const initials = (name: string) => name.split(' ').map((s) => s[0] + '.').join(' ');
const maskPhone = (p: string) => p.replace(/\d(?=.*\d{2}$)/g, '•');
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1•••$2');
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

const crm: AppDef = {
  id: 'crm',
  name: 'Nano CRM',
  tagline: 'Customer database for sales teams',
  sector: 'CRM / SaaS',
  initials: 'NC',
  accent: '#b48cff',
  accountTitle: 'Sales manager workspace',
  intro: 'The manager is signed in to the CRM. The customer list, contact details, pipeline value and the contact export are separately protected. Company rule: only a person may export the contact base.',
  resources: [
    { id: 'customers.list', title: 'Customer list', button: 'Show customers', method: 'GET', view: 'table', data: (s) => { const rows = crmData(s); const cols = [{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'phone', label: 'Phone' }, { key: 'stage', label: 'Stage' }, { key: 'value', label: 'Value ($)', align: 'right' }]; return { full: { columns: cols, rows }, masked: { columns: cols, rows: rows.map((c) => ({ ...c, name: initials(c.name), phone: maskPhone(c.phone), email: maskEmail(c.email), address: '•••', notes: '•••' })) } }; } },
    { id: 'customer.read', title: 'Customer record', button: 'Open customer record', method: 'GET', view: 'kv', note: 'Full contact details of the highest-value customer.', data: (s) => { const c = [...crmData(s)].sort((a, b) => b.value - a.value)[0]!; return { full: kv({ Name: c.name, Company: c.company, Email: c.email, Phone: c.phone, Address: c.address, Stage: c.stage, Value: usd(c.value), Notes: c.notes }), masked: kv({ Name: initials(c.name), Company: c.company, Email: maskEmail(c.email), Phone: maskPhone(c.phone), Address: '•••', Stage: c.stage, Value: usd(c.value), Notes: '•••' }) }; } },
    { id: 'pipeline.read', title: 'Pipeline', button: 'Show pipeline value', method: 'GET', view: 'number', data: (s) => { const rows = crmData(s); const total = rows.filter((c) => c.stage !== 'Closed won').reduce((n, c) => n + c.value, 0); return { full: { value: total, unit: '$', note: `${rows.length} customers, ${rows.filter((c) => c.stage === 'Closed won').length} closed` }, masked: { value: null, unit: '$', note: 'amount masked' } }; } },
    { id: 'contacts.export', title: 'Contact export', button: 'Download contacts (CSV)', method: 'POST', view: 'download', note: 'The whole contact base. Company rule: people only.', data: () => ({ full: null, masked: null }), file: (s) => { const rows = crmData(s); const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`; const lines = ['﻿Name,Company,Email,Phone,Address,Stage,Value', ...rows.map((c) => [c.name, c.company, c.email, c.phone, c.address, c.stage, c.value].map(esc).join(','))]; return { filename: 'nano-crm-contacts.csv', mime: 'text/csv; charset=utf-8', body: lines.join('\n') }; } },
  ],
  policy: { version: 'policy-crm-1', enforcement: 'enforce', rules: [rule('customers.list', 'Customer list', 'mask', 'allow', 'allow'), rule('customer.read', 'Customer record (PII)', 'mask', 'step_up', 'allow'), rule('pipeline.read', 'Pipeline value', 'block', 'mask', 'allow'), rule('contacts.export', 'Contact export', 'block', 'step_up', 'step_up')] },
  promptSteps: ['In "Customer list", click "Load list".', 'In the "Top customer" card, click "Open record".', 'In the "Pipeline" card, click "Show".', 'In the "Contact base" card, click "Export CSV". If a confirmation code is requested, enter the code shown in the dialog.', 'Open the customer record again.'],
};

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------
type Claim = { id: string; date: string; type: string; status: string; amount: number };
function insuranceData(session: string) {
  const r = seeded('ins:' + session);
  const first = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)]!;
  const last = LAST_NAMES[Math.floor(r() * LAST_NAMES.length)]!;
  const memberId = Array.from({ length: 9 }, () => '0123456789'[Math.floor(r() * 10)]).join('');
  const holder = { name: `${first} ${last}`, memberId, dob: `${1960 + Math.floor(r() * 40)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, phone: `+1 (${200 + Math.floor(r() * 700)}) ${String(Math.floor(r() * 900 + 100))}-${String(Math.floor(r() * 9000 + 1000))}`, address: `${Math.floor(r() * 900 + 100)} ${['Oak', 'Maple', 'Cedar', 'Pine'][Math.floor(r() * 4)]} Street, ${CITIES[Math.floor(r() * 4)]}`, policyNo: `HL-${Math.floor(r() * 900000 + 100000)}`, product: 'Health Plus' };
  const claims: Claim[] = [];
  const types = ['Outpatient', 'Inpatient', 'Pharmacy', 'Diagnostics'];
  const statuses = ['Paid', 'In review', 'Declined'];
  const now = Date.now();
  for (let i = 0; i < 6; i++) claims.push({ id: `CL-${1000 + i}`, date: new Date(now - (i + 1) * 17 * 86400000).toISOString().slice(0, 10), type: types[Math.floor(r() * types.length)]!, status: statuses[Math.floor(r() * statuses.length)]!, amount: Math.round((80 + r() * 1900) * 100) / 100 });
  const medical = { diagnosis: ['Hypertension, stage 1', 'Type 2 diabetes, controlled', 'Allergic rhinitis', 'Lumbar disc protrusion'][Math.floor(r() * 4)]!, doctor: `Dr. ${LAST_NAMES[Math.floor(r() * LAST_NAMES.length)]}`, clinic: ['Central Clinic', 'Riverside Medical', 'Lakeview Health'][Math.floor(r() * 3)]!, prescription: ['Amlodipine 5 mg, once daily', 'Metformin 500 mg, twice daily', 'Loratadine 10 mg, once daily', 'Physiotherapy, 10 sessions'][Math.floor(r() * 4)]!, date: new Date(now - 12 * 86400000).toISOString().slice(0, 10) };
  return { holder, claims, medical };
}

const insurance: AppDef = {
  id: 'insurance',
  name: 'Nano Insurance',
  tagline: 'Online portal for policyholders',
  sector: 'Insurance',
  initials: 'NI',
  accent: '#45d483',
  accountTitle: 'Policyholder portal',
  intro: 'The policyholder is signed in. Personal details, claims, the medical report and the policy document are separately protected. Medical data is the most sensitive resource.',
  resources: [
    { id: 'policyholder.read', title: 'Policyholder', button: 'Show personal details', method: 'GET', view: 'kv', data: (s) => { const { holder } = insuranceData(s); return { full: kv({ Name: holder.name, 'Member ID': holder.memberId, 'Date of birth': holder.dob, Phone: holder.phone, Address: holder.address, 'Policy no.': holder.policyNo, Product: holder.product }), masked: kv({ Name: initials(holder.name), 'Member ID': holder.memberId.slice(0, 2) + '•••••••', 'Date of birth': holder.dob.slice(0, 4) + '-••-••', Phone: maskPhone(holder.phone), Address: '•••', 'Policy no.': holder.policyNo, Product: holder.product }) }; } },
    { id: 'claims.list', title: 'Claims', button: 'Show claims', method: 'GET', view: 'table', data: (s) => { const { claims } = insuranceData(s); const cols = [{ key: 'id', label: 'No.' }, { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount ($)', align: 'right' }]; return { full: { columns: cols, rows: claims }, masked: { columns: cols, rows: claims.map((c) => ({ ...c, type: '•••', amount: null })) } }; } },
    { id: 'medical.read', title: 'Medical report', button: 'Open medical report', method: 'GET', view: 'text', note: 'Diagnosis and prescription. The most sensitive data.', data: (s) => { const { medical } = insuranceData(s); return { full: { title: `Medical report · ${medical.date}`, paragraphs: [`Diagnosis: ${medical.diagnosis}`, `Physician: ${medical.doctor}, ${medical.clinic}`, `Prescription: ${medical.prescription}`] }, masked: { title: `Medical report · ${medical.date}`, paragraphs: ['Diagnosis: •••', `Physician: •••, ${medical.clinic}`, 'Prescription: •••'] } }; } },
    { id: 'policy.download', title: 'Policy document', button: 'Download policy', method: 'POST', view: 'download', data: () => ({ full: null, masked: null }), file: (s) => { const { holder, claims } = insuranceData(s); return { filename: `policy-${holder.policyNo}.txt`, mime: 'text/plain; charset=utf-8', body: `NANO INSURANCE — POLICY ${holder.policyNo}\nPolicyholder: ${holder.name}\nMember ID: ${holder.memberId}\nDate of birth: ${holder.dob}\nProduct: ${holder.product}\n\nClaims:\n${claims.map((c) => `${c.id}  ${c.date}  ${c.type}  ${c.status}  $${c.amount}`).join('\n')}\n` }; } },
  ],
  policy: { version: 'policy-insurance-1', enforcement: 'enforce', rules: [rule('policyholder.read', 'Personal details', 'mask', 'mask', 'allow'), rule('claims.list', 'Claims', 'mask', 'allow', 'allow'), rule('medical.read', 'Medical report', 'block', 'step_up', 'step_up'), rule('policy.download', 'Policy document', 'block', 'step_up', 'allow')] },
  promptSteps: ['In the policy card, click "Personal details".', 'In "Claims", click "Show claims".', 'In the "Medical report" card, click "Open report". If a confirmation code is requested, enter the code shown in the dialog.', 'In the policy card, click "Download policy".', 'Show the personal details again.'],
};

function kv(obj: Record<string, string | number | null | undefined>): { label: string; value: string }[] {
  return Object.entries(obj).map(([label, value]) => ({ label, value: value == null ? '—' : String(value) }));
}

export const APPS: Record<string, AppDef> = { bank, crm, insurance };

/** What the browser is allowed to know about an app: no data functions. */
export function publicApp(a: AppDef) {
  return {
    id: a.id, name: a.name, tagline: a.tagline, sector: a.sector, initials: a.initials, accent: a.accent, accountTitle: a.accountTitle, intro: a.intro,
    resources: a.resources.map((r) => ({ id: r.id, title: r.title, button: r.button, method: r.method, view: r.view, input: r.input ?? null, note: r.note ?? null })),
    promptSteps: a.promptSteps,
    rules: a.policy.rules.map((r) => ({ resource: r.resource, onAgent: r.onAgent, onArtifact: r.onArtifact, onUnknown: r.onUnknown })),
  };
}
