# NanoTarget — sales enablement (internal)

Everything a founder needs in a first call. Kept short on purpose; update the numbers from `docs/EVAL.md` before each pitch.

## The one line

> Know the moment an AI agent takes over a signed-in session — on your own server — and hand an auditor a signed proof of every decision.

Thirty-second version:

> Your customers now log in to your product with Claude, ChatGPT and Codex driving the browser. To your server that agent *is* the customer: same cookies, same IP. Bot management stopped at the door; MFA proved who entered. Nobody watches what happens inside the session. NanoTarget sits at the endpoint that returns the data. It marks the agent the moment it attaches, before its first click; seals what is already on screen; lets each endpoint decide — allow, mask, step up, block; and signs every decision so compliance can prove what happened. It runs inside your server. Nothing leaves.

## Who we sell to (and who we do not, yet)

| Sell to | Why they buy | Who signs |
|---|---|---|
| B2B SaaS with an admin panel over customer data (CRM, HR, support, billing) | One operator's session reaches thousands of records; an agent exporting the customer base is a breach | Head of Security / CTO |
| Fintech web back-offices and business banking portals | Regulated; already asked by auditors "how do you know a human approved this"; data-residency rules favour self-hosting | CISO, Compliance |
| Insurance and health portals (web) | Medical and policy documents; export and download are the sensitive paths | CISO |

Not yet: retail mobile banking (needs the touch layer), non-Node backends (sidecar not shipped), consumer apps with no sensitive reads.

## The wedge

One endpoint type: **data export / download**. It is the action every security team already worries about, it is rarely used by real customers many times a day, and the decision is easy to explain: an agent should not be able to pull the whole account in one click.

Rollout that closes: **observe mode for 14 days** → they see the share of sessions with an agent inside (the board number) → **enforce on export only** → expand to reads.

## Discovery questions

1. Do you know today how many of your logged-in sessions have an AI agent operating them? (Nobody does. That is the first number we give them, for free, in observe mode.)
2. Which single action in your product would you least want an agent to perform without a human confirming? (This is the wedge endpoint.)
3. When an incident is investigated, how do you prove whether the customer or software acted? (Signed proofs.)
4. Does customer data have to stay in your infrastructure? Which region? (Self-hosted; nothing leaves.)
5. Who owns the Node services in front of that data, and can they add a middleware this week? (Integration is one prompt to their coding agent.)

## Objections, answered honestly

**"Cloudflare / Akamai already does bot detection."**
At the edge, before login. A logged-in customer's agent carries a real session and a real browser. Edge products see a legitimate user. We sit at the endpoint that returns the data, after login. Different control point; we complement, not replace.

**"We have MFA."**
MFA proves who entered. It says nothing about who is acting ten minutes later. Our passkey reclaim *is* MFA — placed at the moment it matters, on the action, not at the door.

**"GrayPass does this."**
Close neighbour, different question. GrayPass asks whether the *enrolled person* is still in control and needs to learn each user first; their own documentation lists behavioural claims as research and agent detection as unsupported. We ask whether an *agent* is operating the session, with no enrollment, from the first visit, on the customer's own server. A bank may want both.

**"What about false positives?"**
Every threshold is chosen so that no recorded human click in our dataset is judged synthetic — zero false blocks across fifteen recorded human runs on real devices. Start in observe mode: nothing is blocked and every decision is graded. The portal shows the false-stop rate from your own grading. If it is not zero, we fix it before enforce.

**"Agents will change and evade you."**
They do change — we watched Codex change within a week. That is why signatures are a subscription, and why detection has five independent evidence classes plus a passkey path that no agent can fake. We red-team our own detector and publish the limits.

**"Is this biometric data? GDPR?"**
No person is identified and no per-person template exists. The page script measures how a session behaves, not what it contains; raw movement is discarded; nothing is matched across users or sites. Everything stays on their server unless they add an API key, and then only the metadata on `/trust`.

**"Why open source?"**
Security code should be readable — the CISO gets what they see. The SDK and middleware are permissive so legal says yes; the engine is source-available so nobody hosts it against us. We sell the signatures and the evidence layer, not the code.

## The design-partner offer (send as-is)

> Subject: 30 days, free, one number your board has never seen
>
> Hi [name] — quick one. Your customers are starting to log in to [product] with AI agents (Claude, ChatGPT, Codex) driving the browser. To your server those agents look exactly like the customer. We built NanoTarget to tell the difference, at the endpoint, on your own server.
>
> I'd like to run it with you for 30 days in staging, free: observe mode only, nothing blocked. You get one number nobody has today — the share of your signed-in sessions with an agent inside — plus a signed record of every decision your compliance team can verify. Integration is a middleware your team or their coding agent adds in an afternoon; nothing leaves your infrastructure.
>
> In return: permission to publish the numbers with your name once you've approved them.
>
> Twenty minutes this week?
>
> [founder] · nanotarget-mvp.vercel.app

## What to measure in every pilot (so we have numbers with names)

- Sessions observed · sessions with an agent (the headline %)
- Agents seen, by product
- Decisions by outcome · gated decisions
- **False stops** (graded wrong by the customer) — must be zero before enforce
- Time from install to first decision (target: same day)
- One quote from the security lead

## Pricing to test (not to trust)

| | Free | Team | Enterprise |
|---|---|---|---|
| Mode | Observe, one app | Enforce | Self-hosted |
| Signatures | 30 days behind | Current | Current + private feed |
| Audit | Local | Hosted audit + export | Evidence export, SLA, DPA, SSO |
| Price | $0 | $500–1,500 / month | $30k–100k / year |

Let the three design partners tell us the real numbers.

## Demo script (four minutes)

1. Open `/bank` in a normal browser. Click *Show balance*. Point at the decision log: allow, human kinematics.
2. Open the same page with Claude in Chrome. Ask it: "show me the balance and download the statement." Watch the seal (0.3 s), the mask, the block. Read the reason codes aloud.
3. Open the portal → Activity. The events are already there, each with a ✓. Click one ✓: the proofs download.
4. `npx nanotarget verify-proof proofs.json` in a terminal: 3/3 valid. "Your auditor does this without trusting us."
5. Touch ID on the demo: the session comes back. "That is the only thing that proves a human — and no agent has it."
