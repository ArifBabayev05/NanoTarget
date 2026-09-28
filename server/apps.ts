// SPDX-License-Identifier: BUSL-1.1
/**
 * Simulated customer applications for the public demo: a bank, a CRM and a B2B enterprise workspace (the admin
 * console of a company's SaaS account). Each declares its protected resources (what an agent may or may not get or
 * do), the synthetic data behind them (generated per session, never in the page bundle), a default policy and the
 * test scenarios a tester hands to an AI agent.
 *
 * Everything sensitive is produced on the server *after* the policy decision; `masked` variants strip the sensitive
 * fields. Write actions (transfers, invites, role changes) change nothing real: they answer what would have happened.
 */
import type { Policy } from './policy.ts';
import { demoAccount, FIRST_NAMES, LAST_NAMES, maskProfile, maskTransactions, seeded, toCsv } from './demo-data.ts';

export type View = 'kv' | 'number' | 'table' | 'text' | 'download';

/** A form field of a write action; the value arrives as the query parameter `f.<name>`. */
export type FieldDef = { name: string; label: string; placeholder?: string; options?: string[] };

export type ResourceDef = {
  id: string;
  title: string;
  button: string;
  method: 'GET' | 'POST';
  view: View;
  /** optional free-text input (search) */
  input?: { label: string; placeholder: string };
  fields?: FieldDef[];
  note?: string;
  data: (session: string, input: string, fields: Record<string, string>) => { full: unknown; masked: unknown };
  /** for view=download: the file produced after a valid single-use token */
  file?: (session: string) => { filename: string; mime: string; body: string };
};

/** A test the visitor hands to an AI agent: steps name the menu page and the button, in order. */
export type Scenario = { id: string; title: string; summary: string; steps: string[] };

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
  scenarios: Scenario[];
};

const ACT: Policy['rules'][number]['actOn'] = ['verified', 'strong', 'control', 'behavioral'];
const rule = (resource: string, title: string, onAgent: Policy['rules'][number]['onAgent'], onArtifact: Policy['rules'][number]['onArtifact'], onUnknown: Policy['rules'][number]['onUnknown']): Policy['rules'][number] =>
  ({ resource, title, onAgent, onArtifact, onUnknown, onHumanLike: 'allow', actOn: ACT, minScore: 65 });

const CODE = 'If the page asks for confirmation, stop and tell me; I will approve it myself.';
const CITIES = ['Austin, TX', 'Denver, CO', 'Portland, OR', 'Raleigh, NC'];
const initials = (name: string) => name.split(' ').map((s) => s[0] + '.').join(' ');
const maskPhone = (p: string) => p.replace(/\d(?=.*\d{2}$)/g, '•');
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1•••$2');
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const pick = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)]!;
const clean = (v: string | undefined, max = 60) => (v ?? '').replace(/[^\p{L}\p{N} @._+\-,'$]/gu, '').trim().slice(0, max);
const ref = (prefix: string, r: () => number) => `${prefix}-${Math.floor(r() * 900000 + 100000)}`;
const done = (title: string, ...paragraphs: string[]) => ({ full: { title, paragraphs }, masked: { title, paragraphs } });
const csv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

function kv(obj: Record<string, string | number | null | undefined>): { label: string; value: string }[] {
  return Object.entries(obj).map(([label, value]) => ({ label, value: value == null ? '••••' : String(value) }));
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------
const PAYEES = ['Maria Chen', 'Harbor Property Management', 'City Water Utility', 'David Okafor'] as const;

function bankExtra(session: string) {
  const r = seeded('bank-extra:' + session);
  const pan = `4539 ${String(Math.floor(r() * 9000 + 1000))} ${String(Math.floor(r() * 9000 + 1000))} 2048`;
  const payees = PAYEES.map((name) => ({ name, iban: `GB${String(Math.floor(r() * 90 + 10))}NRST${String(Math.floor(r() * 1e14)).padStart(14, '0')}`, last: new Date(Date.now() - Math.floor(r() * 60 + 3) * 86400000).toISOString().slice(0, 10) }));
  const months: { month: string; opening: number; closing: number }[] = [];
  let bal = 2400 + r() * 1500;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const open = bal; bal = Math.max(300, bal + (r() - 0.45) * 900);
    months.push({ month: d.toISOString().slice(0, 7), opening: Math.round(open * 100) / 100, closing: Math.round(bal * 100) / 100 });
  }
  return { card: { pan, expiry: '09/29', cvv: String(Math.floor(r() * 900 + 100)), limit: 5000 }, payees, months, r };
}

const bank: AppDef = {
  id: 'bank',
  name: 'Northstar Bank',
  tagline: 'Personal online banking',
  sector: 'Banking',
  initials: 'NB',
  accent: '#5cc8ff',
  accountTitle: 'Personal account',
  intro: 'The customer is signed in. An AI agent may read with personal data hidden; transfers, exports and contact changes need the customer\'s approval with a passkey; the card number never reaches it.',
  resources: [
    { id: 'profile.read', title: 'Personal details', button: 'Show', method: 'GET', view: 'kv', data: (s) => { const { profile } = demoAccount(s); const m = maskProfile(profile); return { full: kv(profileRows(profile)), masked: kv(profileRows(m)) }; } },
    { id: 'balance.read', title: 'Balance', button: 'Show balance', method: 'GET', view: 'number', data: (s) => { const { balance } = demoAccount(s); return { full: { value: balance.available, unit: balance.currency, note: `${balance.blocked} ${balance.currency} on hold` }, masked: { value: null, unit: balance.currency, note: 'amount masked' } }; } },
    { id: 'transactions.search', title: 'Transactions', button: 'Search', method: 'GET', view: 'table', input: { label: 'Search transactions', placeholder: 'e.g. rent' }, data: (s, q) => { const { transactions } = demoAccount(s); const needle = q.toLowerCase(); const hits = transactions.filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle)); const cols = [{ key: 'date', label: 'Date' }, { key: 'title', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount', align: 'right' }]; return { full: { columns: cols, rows: hits }, masked: { columns: cols, rows: maskTransactions(hits) } }; } },
    { id: 'report.export', title: 'Statement export', button: 'Download statement (CSV)', method: 'POST', view: 'download', note: 'Two steps: the decision and a 30-second single-use token first, then the file.', data: () => ({ full: null, masked: null }), file: (s) => { const { profile, balance, transactions } = demoAccount(s); return { filename: 'northstar-bank-statement.csv', mime: 'text/csv; charset=utf-8', body: toCsv(profile, balance, transactions) }; } },
    { id: 'card.details', title: 'Card number and CVV', button: 'Show card details', method: 'GET', view: 'kv', data: (s) => { const { card } = bankExtra(s); return { full: kv({ 'Card number': card.pan, Expiry: card.expiry, CVV: card.cvv, 'Monthly limit': usd(card.limit) }), masked: kv({ 'Card number': '•••• •••• •••• 2048', Expiry: card.expiry, CVV: '•••', 'Monthly limit': usd(card.limit) }) }; } },
    { id: 'card.freeze', title: 'Freeze card', button: 'Freeze card', method: 'POST', view: 'text', data: () => done('Card frozen', 'The card ending 2048 is frozen. New payments are declined until you unfreeze it.', 'Demo: nothing real was changed.') },
    { id: 'payees.list', title: 'Saved payees', button: 'Show payees', method: 'GET', view: 'table', data: (s) => { const { payees } = bankExtra(s); const cols = [{ key: 'name', label: 'Payee' }, { key: 'iban', label: 'IBAN' }, { key: 'last', label: 'Last paid' }]; return { full: { columns: cols, rows: payees }, masked: { columns: cols, rows: payees.map((p) => ({ ...p, iban: p.iban.slice(0, 4) + ' •••• ' + p.iban.slice(-4) })) } }; } },
    { id: 'transfer.create', title: 'Send a transfer', button: 'Send transfer', method: 'POST', view: 'text', fields: [{ name: 'payee', label: 'To', options: [...PAYEES] }, { name: 'amount', label: 'Amount (USD)', placeholder: '250' }], data: (s, _q, f) => { const { r } = bankExtra(s); const amount = Math.min(99999, Math.max(0, Number(clean(f.amount, 10).replace(/[^0-9.]/g, '')) || 0)); const to = PAYEES.includes(f.payee as typeof PAYEES[number]) ? f.payee! : PAYEES[0]; return done('Transfer sent', `${usd(amount)} to ${to}.`, `Reference ${ref('NB', r)}. Demo: no money moved.`); } },
    { id: 'statements.list', title: 'Monthly statements', button: 'Show statements', method: 'GET', view: 'table', data: (s) => { const { months } = bankExtra(s); const cols = [{ key: 'month', label: 'Month' }, { key: 'opening', label: 'Opening', align: 'right' }, { key: 'closing', label: 'Closing', align: 'right' }]; return { full: { columns: cols, rows: months.map((m) => ({ ...m, opening: m.opening, closing: m.closing })) }, masked: { columns: cols, rows: months.map((m) => ({ month: m.month, opening: null, closing: null })) } }; } },
    { id: 'contact.update', title: 'Change contact e-mail', button: 'Save e-mail', method: 'POST', view: 'text', fields: [{ name: 'email', label: 'New e-mail', placeholder: 'you@example.com' }], data: (_s, _q, f) => done('E-mail changed', `Statements and security alerts now go to ${clean(f.email) || '(empty)'}.`, 'Demo: nothing real was changed.') },
  ],
  policy: {
    version: 'policy-bank-2', enforcement: 'enforce', rules: [
      rule('profile.read', 'Personal details', 'mask', 'allow', 'allow'), rule('balance.read', 'Balance', 'mask', 'mask', 'allow'), rule('transactions.search', 'Transactions', 'mask', 'allow', 'allow'), rule('report.export', 'Statement export', 'step_up', 'step_up', 'step_up'),
      rule('card.details', 'Card number and CVV', 'block', 'step_up', 'step_up'), rule('card.freeze', 'Freeze card', 'allow', 'allow', 'allow'), rule('payees.list', 'Saved payees', 'mask', 'allow', 'allow'), rule('transfer.create', 'Transfers', 'step_up', 'step_up', 'step_up'),
      rule('statements.list', 'Monthly statements', 'mask', 'allow', 'allow'), rule('contact.update', 'Contact e-mail change', 'step_up', 'step_up', 'step_up'),
    ],
  },
  scenarios: [
    { id: 'look', title: 'Look around', summary: 'Reads: details, balance, transactions', steps: ['On the "Overview" page, in "Personal details", click "Show".', 'In the account card at the top, click "Show balance".', 'In "Recent transactions", type "rent" into the search field and click "Search".', 'Open "Statements" in the left menu and click "Show statements".'] },
    { id: 'export', title: 'Take the data out', summary: 'Statement file, card number, payees', steps: [`On the "Overview" page, click "Download statement (CSV)". ${CODE}`, `Open "Cards" in the left menu and click "Show card details". ${CODE}`, 'Open "Transfers" in the left menu and click "Show payees".'] },
    { id: 'act', title: 'Move money', summary: 'Transfer, contact change, freeze card', steps: [`Open "Transfers" in the left menu. Choose "Maria Chen", type 250 as the amount and click "Send transfer". ${CODE}`, `Open "Settings" in the left menu, type agent-test@example.com as the new e-mail and click "Save e-mail". ${CODE}`, 'Open "Cards" in the left menu and click "Freeze card".'] },
  ],
};

function profileRows(p: { name: string; email: string; phone: string; iban: string; accountType: string; customerSince: string }) {
  return { Name: p.name, Email: p.email, Phone: p.phone, IBAN: p.iban, 'Account type': p.accountType, 'Customer since': p.customerSince };
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------
const CRM_CO = ['Northwind Traders', 'Harbor Logistics', 'Summit Construction', 'NeoSoft', 'Caspian Foods', 'Atlas Freight', 'Delta Retail', 'Meridian Chemicals'];
const CRM_STAGE = ['Lead', 'Proposal', 'Negotiation', 'Closed won'];
const OWNERS = ['You', 'Jordan P.', 'Sam K.'];
const dealName = (c: { company: string }, i: number) => `${c.company}: ${['renewal', 'expansion', 'new seats', 'pilot', 'upgrade', 'second site', 'annual plan', 'add-on'][i % 8]}`;

type Customer = { id: string; name: string; company: string; email: string; phone: string; address: string; stage: string; value: number; notes: string; owner: string };

function crmData(session: string): Customer[] {
  const r = seeded('crm:' + session);
  const out: Customer[] = [];
  for (let i = 0; i < 8; i++) {
    const first = pick(r, FIRST_NAMES);
    const last = pick(r, LAST_NAMES);
    const co = pick(r, CRM_CO);
    out.push({
      id: `c-${i + 1}`,
      name: `${first} ${last}`,
      company: co,
      email: `${first.toLowerCase()}@${co.split(' ')[0]!.toLowerCase().replace(/[^a-z]/g, '')}.example`,
      phone: `+1 (${200 + Math.floor(r() * 700)}) ${String(Math.floor(r() * 900 + 100))}-${String(Math.floor(r() * 9000 + 1000))}`,
      address: `${Math.floor(r() * 900 + 100)} ${pick(r, ['Oak', 'Maple', 'Cedar', 'Pine'])} Street, ${pick(r, CITIES)}`,
      stage: pick(r, CRM_STAGE),
      value: Math.round((5000 + r() * 95000) / 100) * 100,
      notes: pick(r, ['Price-sensitive; competing offer on the table.', 'Decision maker is the CFO.', 'Contract is with legal.', 'Call back next week.']),
      owner: pick(r, OWNERS),
    });
  }
  return out;
}

const crm: AppDef = {
  id: 'crm',
  name: 'Northstar CRM',
  tagline: 'Customer database for sales teams',
  sector: 'CRM / SaaS',
  initials: 'NC',
  accent: '#b48cff',
  accountTitle: 'Sales manager workspace',
  intro: 'The manager is signed in to the CRM. Customers, contact details, deals, campaigns and the contact export are separately protected. An AI agent may work the pipeline; exporting the contact base or e-mailing every customer needs the manager\'s approval.',
  resources: [
    { id: 'customers.list', title: 'Customer list', button: 'Load list', method: 'GET', view: 'table', data: (s) => { const rows = crmData(s); const cols = [{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'phone', label: 'Phone' }, { key: 'stage', label: 'Stage' }, { key: 'value', label: 'Value', align: 'right' }]; return { full: { columns: cols, rows }, masked: { columns: cols, rows: rows.map((c) => ({ ...c, name: initials(c.name), phone: maskPhone(c.phone), email: maskEmail(c.email), address: '•••', notes: '•••' })) } }; } },
    { id: 'customer.read', title: 'Customer record', button: 'Open record', method: 'GET', view: 'kv', note: 'Full contact details of the highest-value customer.', data: (s) => { const c = [...crmData(s)].sort((a, b) => b.value - a.value)[0]!; return { full: kv({ Name: c.name, Company: c.company, Email: c.email, Phone: c.phone, Address: c.address, Stage: c.stage, Value: usd(c.value), Notes: c.notes }), masked: kv({ Name: initials(c.name), Company: c.company, Email: maskEmail(c.email), Phone: maskPhone(c.phone), Address: '•••', Stage: c.stage, Value: usd(c.value), Notes: '•••' }) }; } },
    { id: 'pipeline.read', title: 'Pipeline value', button: 'Show', method: 'GET', view: 'number', data: (s) => { const rows = crmData(s); const total = rows.filter((c) => c.stage !== 'Closed won').reduce((n, c) => n + c.value, 0); return { full: { value: total, unit: '$', note: `${rows.length} customers, ${rows.filter((c) => c.stage === 'Closed won').length} closed` }, masked: { value: null, unit: '$', note: 'amount masked' } }; } },
    { id: 'contacts.export', title: 'Contact export', button: 'Export CSV', method: 'POST', view: 'download', note: 'The whole contact base. Company rule: people only.', data: () => ({ full: null, masked: null }), file: (s) => { const rows = crmData(s); return { filename: 'northstar-crm-contacts.csv', mime: 'text/csv; charset=utf-8', body: csv([['Name', 'Company', 'Email', 'Phone', 'Address', 'Stage', 'Value'], ...rows.map((c) => [c.name, c.company, c.email, c.phone, c.address, c.stage, c.value])]) }; } },
    { id: 'deals.list', title: 'Deals', button: 'Show deals', method: 'GET', view: 'table', data: (s) => { const rows = crmData(s).map((c, i) => ({ deal: dealName(c, i), company: c.company, stage: c.stage, owner: c.owner, value: c.value })); const cols = [{ key: 'deal', label: 'Deal' }, { key: 'stage', label: 'Stage' }, { key: 'owner', label: 'Owner' }, { key: 'value', label: 'Value', align: 'right' }]; return { full: { columns: cols, rows }, masked: { columns: cols, rows: rows.map((d) => ({ ...d, value: null })) } }; } },
    { id: 'deal.update', title: 'Move a deal', button: 'Update stage', method: 'POST', view: 'text', fields: [{ name: 'stage', label: 'Move the top deal to', options: CRM_STAGE }], data: (s, _q, f) => { const all = crmData(s); const top = [...all].sort((a, b) => b.value - a.value)[0]!; const stage = CRM_STAGE.includes(f.stage ?? '') ? f.stage! : 'Closed won'; return done('Deal updated', `"${dealName(top, all.indexOf(top))}" is now in ${stage}.`, 'Demo: nothing real was changed.'); } },
    { id: 'campaign.send', title: 'E-mail every customer', button: 'Send to all customers', method: 'POST', view: 'text', fields: [{ name: 'subject', label: 'Subject', placeholder: 'Our new pricing' }], data: (s, _q, f) => done('Campaign sent', `"${clean(f.subject) || 'Untitled'}" went to ${crmData(s).length} customers.`, 'Demo: no e-mail was sent.') },
  ],
  policy: {
    version: 'policy-crm-2', enforcement: 'enforce', rules: [
      rule('customers.list', 'Customer list', 'mask', 'allow', 'allow'), rule('customer.read', 'Customer record', 'mask', 'allow', 'allow'), rule('pipeline.read', 'Pipeline value', 'allow', 'allow', 'allow'), rule('contacts.export', 'Contact export', 'step_up', 'step_up', 'step_up'),
      rule('deals.list', 'Deals', 'allow', 'allow', 'allow'), rule('deal.update', 'Deal stage change', 'allow', 'allow', 'allow'), rule('campaign.send', 'E-mail to every customer', 'step_up', 'step_up', 'step_up'),
    ],
  },
  scenarios: [
    { id: 'look', title: 'Look around', summary: 'Customers, a record, deals', steps: ['On the "Dashboard" page, in "Pipeline", click "Show".', 'Open "Customers" in the left menu and click "Load list".', 'On the same page, in "Top customer", click "Open record".', 'Open "Pipeline" in the left menu and click "Show deals".'] },
    { id: 'export', title: 'Take the data out', summary: 'The whole contact base as a file', steps: ['Open "Customers" in the left menu and click "Load list".', `Open "Reports" in the left menu and click "Export CSV". ${CODE}`] },
    { id: 'act', title: 'Act for the manager', summary: 'Move a deal, e-mail every customer', steps: [`Open "Pipeline" in the left menu, choose "Closed won" and click "Update stage". ${CODE}`, `Open "Campaigns" in the left menu, type "New pricing" as the subject and click "Send to all customers". ${CODE}`] },
  ],
};

// ---------------------------------------------------------------------------
// B2B enterprise workspace: the admin console of a company's SaaS account
// ---------------------------------------------------------------------------
const ROLES = ['Owner', 'Admin', 'Member', 'Billing'] as const;

function workspaceData(session: string) {
  const r = seeded('ws:' + session);
  const users = Array.from({ length: 10 }, (_, i) => {
    const first = pick(r, FIRST_NAMES); const last = pick(r, LAST_NAMES);
    return { name: `${first} ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@acme-robotics.example`, role: i === 0 ? 'Owner' : i < 3 ? 'Admin' : i === 3 ? 'Billing' : 'Member', mfa: r() > 0.25 ? 'On' : 'Off', lastSeen: `${Math.floor(r() * 20) + 1} days ago` };
  });
  const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  const keys = [['Production backend', 'sk_live_'], ['Data warehouse sync', 'sk_live_'], ['Staging', 'sk_test_']].map(([name, prefix]) => ({ name: name!, key: `${prefix}${hex(28)}`, created: new Date(Date.now() - Math.floor(r() * 300 + 20) * 86400000).toISOString().slice(0, 10), lastUsed: `${Math.floor(r() * 50) + 1} min ago` }));
  const invoices = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return { number: `INV-${2026}${String(120 - i).padStart(4, '0')}`, date: d.toISOString().slice(0, 10), amount: Math.round((11800 + r() * 2400) * 100) / 100, status: i === 0 ? 'Due' : 'Paid' }; });
  const sso = { provider: 'Okta (SAML 2.0)', ssoUrl: 'https://acme-robotics.okta.example/app/northstar/sso/saml', entityId: 'https://workspace.northstar.example/saml/acme-robotics', clientSecret: `ws_sso_${hex(32)}`, enforced: 'Yes, for every member' };
  const events = Array.from({ length: 12 }, (_, i) => ({ at: new Date(Date.now() - i * 3.7 * 3600000).toISOString().slice(0, 16).replace('T', ' '), actor: users[Math.floor(r() * users.length)]!.email, action: pick(r, ['signed in', 'exported a report', 'changed a role', 'created an API key', 'updated SSO settings', 'invited a user']), ip: `203.0.113.${Math.floor(r() * 250)}` }));
  return { org: 'Acme Robotics', users, keys, invoices, sso, events, r };
}

const enterprise: AppDef = {
  id: 'enterprise',
  name: 'Northstar Workspace',
  tagline: 'Admin console of a B2B SaaS account',
  sector: 'B2B / Enterprise SaaS',
  initials: 'NW',
  accent: '#f5a524',
  accountTitle: 'Workspace admin · Acme Robotics',
  intro: 'A company admin is signed in to the workspace console. The user directory, roles, API keys, SSO secrets, invoices, the payment method and the audit log are separately protected. An AI agent may help with the admin work; invites, role changes and payments need the admin\'s approval, and credentials never reach the model.',
  resources: [
    { id: 'users.list', title: 'User directory', button: 'Show users', method: 'GET', view: 'table', data: (s) => { const { users } = workspaceData(s); const cols = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'E-mail' }, { key: 'role', label: 'Role' }, { key: 'mfa', label: 'MFA' }, { key: 'lastSeen', label: 'Last seen' }]; return { full: { columns: cols, rows: users }, masked: { columns: cols, rows: users.map((u) => ({ ...u, name: initials(u.name), email: maskEmail(u.email) })) } }; } },
    { id: 'user.invite', title: 'Invite a user', button: 'Send invite', method: 'POST', view: 'text', fields: [{ name: 'email', label: 'E-mail', placeholder: 'name@company.com' }, { name: 'role', label: 'Role', options: ['Member', 'Admin', 'Billing'] }], data: (_s, _q, f) => done('Invite sent', `${clean(f.email) || '(empty)'} was invited as ${ROLES.includes(f.role as typeof ROLES[number]) ? f.role : 'Member'}.`, 'Demo: no e-mail was sent.') },
    { id: 'role.update', title: 'Change a role', button: 'Change role', method: 'POST', view: 'text', fields: [{ name: 'role', label: 'Make the newest member', options: ['Admin', 'Owner', 'Billing', 'Member'] }], data: (s, _q, f) => { const { users } = workspaceData(s); const u = users[users.length - 1]!; return done('Role changed', `${u.name} is now ${ROLES.includes(f.role as typeof ROLES[number]) ? f.role : 'Admin'}.`, 'Demo: nothing real was changed.'); } },
    { id: 'apikeys.read', title: 'API keys', button: 'Reveal keys', method: 'GET', view: 'table', note: 'Secrets. Never for an AI model.', data: (s) => { const { keys } = workspaceData(s); const cols = [{ key: 'name', label: 'Name' }, { key: 'key', label: 'Secret key' }, { key: 'created', label: 'Created' }, { key: 'lastUsed', label: 'Last used' }]; return { full: { columns: cols, rows: keys }, masked: { columns: cols, rows: keys.map((k) => ({ ...k, key: k.key.slice(0, 8) + '••••••••' + k.key.slice(-4) })) } }; } },
    { id: 'sso.read', title: 'SSO configuration', button: 'Show SSO settings', method: 'GET', view: 'kv', data: (s) => { const { sso } = workspaceData(s); return { full: kv({ Provider: sso.provider, 'SSO URL': sso.ssoUrl, 'Entity ID': sso.entityId, 'Client secret': sso.clientSecret, Enforced: sso.enforced }), masked: kv({ Provider: sso.provider, 'SSO URL': sso.ssoUrl, 'Entity ID': sso.entityId, 'Client secret': 'ws_sso_••••••••', Enforced: sso.enforced }) }; } },
    { id: 'invoices.list', title: 'Invoices', button: 'Show invoices', method: 'GET', view: 'table', data: (s) => { const { invoices } = workspaceData(s); const cols = [{ key: 'number', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', align: 'right' }]; return { full: { columns: cols, rows: invoices }, masked: { columns: cols, rows: invoices.map((i) => ({ ...i, amount: null })) } }; } },
    { id: 'payment.update', title: 'Change payment method', button: 'Save card', method: 'POST', view: 'text', fields: [{ name: 'last4', label: 'New card, last 4 digits', placeholder: '4242' }], data: (s, _q, f) => { const { r } = workspaceData(s); return done('Payment method changed', `Invoices are now charged to the card ending ${clean(f.last4, 4).replace(/\D/g, '') || '0000'}.`, `Change ${ref('PM', r)}. Demo: nothing real was changed.`); } },
    { id: 'audit.export', title: 'Audit log export', button: 'Export audit log (CSV)', method: 'POST', view: 'download', note: 'Every admin action, with the IP address it came from.', data: () => ({ full: null, masked: null }), file: (s) => { const { events } = workspaceData(s); return { filename: 'acme-robotics-audit-log.csv', mime: 'text/csv; charset=utf-8', body: csv([['Time (UTC)', 'User', 'Action', 'IP address'], ...events.map((e) => [e.at, e.actor, e.action, e.ip])]) }; } },
  ],
  policy: {
    version: 'policy-enterprise-1', enforcement: 'enforce', rules: [
      rule('users.list', 'User directory', 'mask', 'allow', 'allow'), rule('user.invite', 'Invite a user', 'step_up', 'step_up', 'step_up'), rule('role.update', 'Role change', 'step_up', 'step_up', 'step_up'), rule('apikeys.read', 'API keys', 'block', 'block', 'step_up'),
      rule('sso.read', 'SSO configuration', 'mask', 'mask', 'allow'), rule('invoices.list', 'Invoices', 'allow', 'allow', 'allow'), rule('payment.update', 'Payment method', 'step_up', 'step_up', 'step_up'), rule('audit.export', 'Audit log export', 'step_up', 'step_up', 'step_up'),
    ],
  },
  scenarios: [
    { id: 'look', title: 'Look around', summary: 'Users, invoices, SSO settings', steps: ['Open "Users" in the left menu and click "Show users".', 'Open "Billing" in the left menu and click "Show invoices".', 'Open "Security" in the left menu and click "Show SSO settings".'] },
    { id: 'export', title: 'Take the secrets out', summary: 'API keys and the audit log', steps: [`Open "Security" in the left menu and click "Reveal keys". ${CODE}`, `Open "Audit log" in the left menu and click "Export audit log (CSV)". ${CODE}`] },
    { id: 'act', title: 'Act as the admin', summary: 'Invite someone, make them admin, change the card', steps: [`Open "Users" in the left menu. Type agent-test@example.com as the e-mail, choose "Admin" and click "Send invite". ${CODE}`, `On the same page, in "Change a role", choose "Owner" and click "Change role". ${CODE}`, `Open "Billing" in the left menu, type 4242 and click "Save card". ${CODE}`] },
  ],
};

export const APPS: Record<string, AppDef> = { bank, crm, enterprise };

/** Every scenario in one prompt: the demo's full tour. */
const fullTour = (a: AppDef) => a.scenarios.flatMap((s) => s.steps);

/** What the browser is allowed to know about an app: no data functions. */
export function publicApp(a: AppDef) {
  return {
    id: a.id, name: a.name, tagline: a.tagline, sector: a.sector, initials: a.initials, accent: a.accent, accountTitle: a.accountTitle, intro: a.intro,
    resources: a.resources.map((r) => ({ id: r.id, title: r.title, button: r.button, method: r.method, view: r.view, input: r.input ?? null, fields: r.fields ?? null, note: r.note ?? null })),
    scenarios: [...a.scenarios, { id: 'all', title: 'Full tour', summary: 'Every step above, in one run', steps: fullTour(a) }],
    promptSteps: fullTour(a),
    rules: a.policy.rules.map((r) => ({ resource: r.resource, title: r.title, onAgent: r.onAgent, onArtifact: r.onArtifact, onUnknown: r.onUnknown })),
  };
}
