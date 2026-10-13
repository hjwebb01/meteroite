# Meteroite app design

## Summary

Meteroite is a private, orientation-first workspace for someone reviewing another person’s pull request. Its job is to explain what changed, why the change matters, and where to begin reading, without replacing the reviewer’s judgment. The distinctive interaction is a purpose-based **change brief** that contracts into a **context spine** as exact source opens beside it. A mostly monospace interface, softly lit graphite layers, restrained translucent chrome, opaque source surfaces, and cyan contextual accents carry the visual identity across the public landing, authentication handoff, intake, analysis activity, review workspace, history, and account entry points. Findings expand at their source locations. Human section-reading marks are explicit and revision-scoped; machine analysis is separate. Publishing passes through an exact-output preview, and changed revisions require acknowledgment. This document records 24 answered interview decisions and the resulting production implementation. The redesign has been implemented in the production app (see “Implementation status” below); earlier development prototypes remain untouched and are not the deliverable. Live GitHub publication/application against a real PR remains unexercised because the test account has no GitHub connection (see blockers below).

## Terms

| Term             | Definition                                                                                                                                           | Avoid                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Finding          | An individual review concern tied to source evidence, to be judged rather than blindly accepted.                                                     | “Guaranteed bug.”                                    |
| Private review   | Review work that is not posted to GitHub unless the user explicitly publishes it.                                                                    | “Automatically public.”                              |
| Primary reviewer | The person evaluating someone else’s pull request, deciding which concerns merit feedback.                                                           | Treating the PR author as the default user.          |
| Change brief     | A compact orientation view of a PR, organized by purpose and linked to the exact changed source.                                                     | “Executive dashboard”; “verified account of intent.” |
| Source plane     | The opaque, high-contrast reading surface containing actual code and diff evidence.                                                                  | “Glass code card.”                                   |
| Read section     | A purpose-based section the human reviewer explicitly acknowledges reading at a saved revision; this says nothing about correctness or merge safety. | “Safe”; “approved”; “AI reviewed.”                   |
| Analysis status  | The state of the machine’s review work, separate from any human acknowledgment.                                                                      | “Human completion.”                                  |

**Context spine** is the contracted form of the change brief, not global app navigation. It retains the selected purpose, generated-interpretation label, section navigation, reading marks, and access to all changes. **Saved revision** means the pinned commit associated with the saved review, not whatever commit is currently at the PR branch head. **Reassessment** is an explicitly requested analysis of updated source, not an automatic background expense.

## Why

Hunter asked for “an in-depth” process to get “a new and unique design that makes sense for my app.” Earlier prototype rounds were rejected for feeling too similar; Hunter subsequently preferred Patchlight and asked to explore from it. During this interview, Hunter clarified that Patchlight’s distinctive visual identity—cyan, contrast, composition, and atmosphere—was the quality to retain, rather than necessarily its source-first layout. Hunter also selected the reviewer as the primary user, understanding an unfamiliar change as the central job, and the whole product as the scope.

The problem is therefore not a palette refresh or another dashboard template. The app needs an understandable, recognizable interaction structure that survives real PRs, long source, incomplete analysis, private investigation, revised commits, and deliberate GitHub publication. Its visual identity must support that work rather than imply certainty, completeness, or publication that has not occurred.

The rejected-option rationales below describe the consequences of the chosen direction. They are design reasoning, not additional quotations attributed to Hunter.

## Locked decisions

### Q1 — Design primarily for the reviewer

**Decision: B.** The default user is evaluating someone else’s change and deciding what deserves feedback. PR identity, purpose, source context, and review concerns take precedence over author coaching or portfolio-level management.

**Rejected:**

- **A, the author’s private second look:** useful, but not the selected primary moment. Intake and language must not assume the reviewer owns the source branch or is preparing their own PR.
- **C, maintainer-wide merge triage:** would favor queues and aggregate readiness over understanding one change. Meteroite’s default is not a merge command center.
- **D, learning-developer coaching:** would make explanation and correction lessons the main product. Explanations remain useful, but the app should not default to a tutorial.

**Consequence:** investigation and suggested fixes are available, but reviewer comprehension comes first. Applying a proposal is not presumed possible merely because a user can review the PR.

### Q4 — Orientation is the central product value

**Decision: A.** Help the reviewer understand what changed, why it matters, and where to start reading. This determines the initial review surface and the marketing promise.

**Rejected:**

- **B, verifying suspected problems as the main job:** evidence inspection remains essential, but a bug queue should not be the reviewer’s first and only representation of the PR.
- **C, completing and publishing feedback as the main job:** publication is a downstream outcome, not the opening pressure.
- **D, coverage management as the main job:** coverage and unread sections support orientation; a completion dashboard does not lead the experience.

**Consequence:** the main view is a change brief, not a severity chart, score card, or list of findings. Assessment information remains accessible and correctly labeled as machine output.

### Q7 — Use a purpose-based change brief

**Decision: A.** Present a compact account of the change, with purpose-based sections that open their exact source.

The opening brief contains PR identity and saved revision, a clearly labeled generated account, section titles and concise purpose statements, source grounding, available finding indicators, and explicit human reading state. A purpose section can reference multiple files or hunks. Display real counts only; do not invent dependency relationships or claim that every part of the PR has been explained.

**Rejected:**

- **B, a guided sequence:** imposes an order before the reviewer has chosen what matters. The brief can suggest useful entry points without turning review into a wizard.
- **C, a spatial map:** creates a stronger visual metaphor but requires careful scaling and relationship semantics. Existing purpose groups do not establish a proven dependency graph.
- **D, a continuous source document as the primary entry:** asks the unfamiliar reviewer to begin reading before receiving the orientation they came for.

**Consequence:** the brief is an interpretation layer connected to evidence, not proof of intent. Ungrouped source must remain visible as a limitation and reachable as source.

### Q9 — Put history in a header switcher

**Decision: C.** The active PR receives a focused workspace. A clearly labeled header switcher opens recent and saved reviews on demand.

The header provides Meteroite identity/home, current PR identity or the review switcher, New review, private/public state where applicable, and account access. History entries expose PR identity and actual saved status; machine analysis and human reading progress must remain distinguishable. The switcher must provide access to the full saved history, not only a truncated recent list.

**Rejected:**

- **A, a library-first navigation model:** switching should not require leaving the workbench for a separate library every time.
- **B, a permanent history rail:** consumes source width and recreates the generic sidebar framing the new composition is intended to avoid.

**Consequence:** the context spine beside source must not acquire account, history, or other global navigation. Its job is explaining the active change.

### Q10 — Contract the brief beside the source

**Decision: A.** Selecting a section changes the opening brief into a narrow context spine while the source plane opens beside it. Both remain visible when there is enough width to read them comfortably.

The transition preserves section identity. The selected purpose and its grounding remain available in the spine; the source opens at the corresponding saved hunk. Source receives the dominant width. Selecting another section changes the evidence context without discarding the entire workspace. Returning to the expanded brief preserves the selected section and explicit reading marks.

At widths where simultaneous reading becomes cramped, use successive full-width views rather than a miniature desktop layout. Keep a visible return-to-brief control and the current section identity. Do not choose a breakpoint merely by device label; base it on usable source and context widths.

**Rejected:**

- **B, replacing the brief completely:** maximizes code width but separates source from the explanation that led the reviewer there.
- **C, unfolding source beneath each brief section:** produces a growing document rather than the selected overview-to-evidence composition, and makes switching between purposes more scroll-dependent.

**Consequence:** this transition—not glowing cards or a decorative map—is the signature interaction. Reduced-motion users receive the same stable state change without animated travel.

### Q12 — Label generated interpretation once, with local grounding

**Decision: B.** The brief has one prominent generated-brief label, retained in its contracted form. Each purpose section carries exact source links. Repeat local labels for uncertainty, missing coverage, or gaps rather than warning beneath every sentence.

The app must not imply author intent was independently verified. Source grounding identifies what supports the explanation; it does not certify that the explanation is correct. Do not display invented numeric confidence. If a referenced location is unavailable, explain the unavailable evidence rather than quietly navigating to a nearby unrelated line.

**Rejected:**

- **A, repeating an interpretation label for every section:** is more explicit but introduces visual repetition without replacing the need for precise grounding.
- **C, a factual-inventory stage before generated interpretation:** makes the reviewer cross another stage before reaching the promised orientation. The full inventory remains an available secondary path instead.

### Q13 — Inspect findings inline at their source

**Decision: A.** A finding opens as an anchored inspection at its actual source location, preserving nearby code and the context spine.

The active inspection presents the concern, severity as text as well as styling, exact saved file/line/side and revision, evidence and explanation, suggested correction when available, discussion, and progressively disclosed advanced work. Other findings remain compact, distinguishable markers. A discussion can grow without creating a permanent third pane; closing it restores the source reading position.

When supporting evidence lives elsewhere, explicit links navigate to those saved locations and provide a route back to the active finding. Do not render the claim as though all its evidence necessarily comes from the single anchor line.

**Rejected:**

- **B, a side inspector:** accommodates long discussions but separates the concern from its immediate code and competes with source width.
- **C, a dedicated finding focus replacing source:** creates another context switch and obscures the selected purpose while the reviewer evaluates a claim.

**Consequence:** expansion must preserve focus and stable source anchors. No layout should jump the user to a different finding merely because discussion or investigation updates.

### Q17 — Separate publication into an exact-output preview

**Decision: A.** Publishing opens a dedicated preview, not an immediate remote write. Show the target repository and PR, saved commit, review type, outgoing review body, and outgoing inline comments with their targets. Confirmation performs publication; leaving the preview does not.

Private discussions, human read marks, and proposed patches are not automatically outgoing GitHub content. The preview explains what remains private. Applying a patch is a separate consequential action with its own target and manifest inspection; publication is not application, approval, or merge.

The current serializer supports normal inline publication and a summary-only fallback when GitHub rejects inline placement. A truthful preview must use the same serializer and exclusion rules as publication, including truncation and retracted findings. Present the exact normal and possible fallback representations before confirmation if the existing fallback is retained. Do not show an approximate paraphrase and call it exact. If the eligible findings, saved revision, or serialized output change after preview, refresh the preview and require a new confirmation rather than posting unseen content.

After success, show actual published state and a GitHub link. If success cannot be confirmed, retain the recoverable state and do not infer a remote write from the button click alone. Preserve the existing duplicate-post recovery behavior.

**Rejected:**

- **B, a confirmation dialog:** is faster but cramped for long real reviews and source-targeted comments.
- **C, a collapsed preview inside a summary:** weakens the distinction between private reading and the consequential external action.

**Consequence:** exact preview is implemented: the preview renders the same serialized normal and summary-only fallback output that publication would send, and confirmation is bound by SHA-256 to content, target, and live revisions with atomic claim/write authorization server-side (see “Implementation status”).

### Q20 — Require acknowledgment of changed revisions

**Decision: B.** Before continuing a review known to be behind the PR, show a revision-change interstitial. Offer two explicit choices: inspect the saved revision or request reassessment. Identify the saved and newer revisions when available. Do not automatically rerun analysis or spend resources.

Inspecting the saved revision retains access to its original source, findings, discussion, and read marks, with its revision clearly visible. Choosing reassessment enters the real activity flow and ultimately produces a newly assessed review. Old and new evidence must not be blended under a latest-revision label.

Publishing and patch application must handle the current revision boundary explicitly. A dismissed interstitial is not authorization to perform stale remote actions. An unavailable freshness check is an unknown state, not proof the saved review is current.

**Rejected:**

- **A, only a persistent revision strip:** is less interruptive but can be missed. The user selected explicit acknowledgment over preserving uninterrupted rereading.

**Consequence:** do not recreate an endless interstitial loop while a person intentionally reads a historical revision. Preserve the acknowledgment for that saved/newer-revision pair during the current viewing session; a subsequent distinct revision change warrants a new acknowledgment. The saved revision label remains visible after acknowledgment.

### Q21 — Track explicit human section reading

**Decision: B.** A reviewer marks purpose-based sections read. This is separate from machine analysis, finding conclusions, publication, and code correctness.

Each section offers a clear Mark read action and a way to return it to unread. The action is an acknowledgment, not a checkbox automatically set by scrolling, visiting a line, or receiving a completed AI result. Reading indicators appear in the brief and context spine; a Continue review entry can summarize actual persisted marks. Do not claim the entire PR was reviewed merely because every generated purpose section was marked read: ungrouped source may still exist.

**Rejected:**

- **A, no human tracker:** avoids new persistence work but does not support the selected orientation-and-return workflow as directly.
- **C, human finding disposition instead:** supports feedback preparation but does not represent reading the change as a whole. Do not quietly add a second human-disposition system to this design.

**Required new contract:** store marks for the authenticated reviewer, tied to the saved review, its pinned revision, and a stable saved section identity. Enforce ownership on reads and writes. Marks must survive navigation and reload, and failed writes must not be represented as saved. The existing machine verdicts cannot be reused as these marks. Ungrouped or missing sections cannot be assigned fabricated completion state.

### Q22 — Do not inherit read marks into a newly assessed revision

**Decision: A.** Historical marks stay with the historical saved review. Every purpose section of a newly assessed revision begins unread.

**Rejected:**

- **B, carrying marks for apparently unchanged sections:** reduces repeated acknowledgment but requires proving equivalence of purpose, membership, content, and context across generated sections. It risks overstating human reading when related source elsewhere changed.

**Consequence:** do not match section titles across revisions and copy their marks. New analysis must not overwrite historical progress. Immutable saved-section identity is part of the reading-state contract; regenerated interpretation is not the same section merely because a heading looks familiar.

## Routine choices

- **Q2 — Preserve Patchlight’s visual identity, not its exact layout (C).** Cyan, contrast, composition, and atmosphere are the reference. The new brief-to-source behavior is not required to copy Patchlight’s file spine, panels, or source-first opening. Privacy and precise evidence remain product requirements, but neither was selected as the specific visual attraction in this question.
- **Q3 — Cover the whole product (C).** The identity applies to the public landing, authentication handoff, contextual setup, intake, activity, brief/source workspace, history, publication preview, and account entry points. Do not deliver a convincing review screen surrounded by unrelated generic screens. Existing provider-owned authentication/account functionality remains real; branding it does not authorize replacing it with a fake custom account system.
- **Q5 — Use material depth (D).** Layers, subtle translucency, and restrained lighting distinguish persistent context from temporary surfaces. Depth has a semantic job, not a decorative one. Navigation and transient switchers can use translucent treatment; code and extended reading areas are opaque. Avoid repeated glow, glossy cards for every datum, or a fictional space-flight metaphor.
- **Q6 — Demonstrate before authentication (B).** The public landing is concise and embeds a hands-on, clearly labeled sample review. It demonstrates the purpose brief, the contract-to-source interaction, and inline evidence using fixed illustrative source. Sign-in is the next step for a real PR. No anonymous repository fetch, account connection, publishing, or branch write occurs through the sample. Label sample interpretation as illustrative rather than claiming a live model generated it during the visit. Use the same interaction vocabulary as the app so the transition is understandable; do not disguise a static screenshot as a working review.
- **Q8 — Default to deep graphite (A).** Use softly lit layered dark surfaces, quiet translucent chrome, and cyan to mark active context. Foreground text, code syntax, muted metadata, selection, and focus must remain readable on their actual surfaces. Cyan is not the severity scale and not proof of correctness. Cool light and a bright/dark split were not selected. This choice sets the default atmosphere; the interview did not authorize a new theme-preference system.
- **Q11 — Use predominantly monospace typography (C).** Interface hierarchy comes from scale, spacing, and weight rather than a sans-serif or editorial-serif contrast. The user explicitly rejected the recommended sans-serif direction. Avoid terminal imitation: prompts, fake command lines, ASCII decoration, all-caps paragraphs, and equally weighted text are not consequences of monospace. Use a legible face with distinguishable characters, restrained heading sizes, and comfortable explanatory line lengths. Long paths need sensible presentation without losing access to their full value; long source lines may scroll within source, never expand the whole document.
- **Q14 — Default to unified diffs (B).** Keep surrounding context available. Offer side-by-side comparison on sufficiently wide screens, without sacrificing the context spine or producing unreadable half-width code. Preserve exact old/new sides and line numbers; removed-line evidence must not be relabeled as new source. Changed hunks alone are not the complete understanding surface.
- **Q15 — Optimize phones for quick orientation and evidence checks (A).** Brief and source become successive full-width views. Preserve section identity, saved revision, and a return path. Investigation, discussion, explicit read marking, history, and deliberate publication remain reachable; this is not permission to make the phone a nonfunctional teaser. Temporary surfaces must not hide controls behind the on-screen keyboard or lock source into a tiny nested scroll area.
- **Q16 — Progressively disclose advanced work (A).** In an open finding, show the claim and evidence first, then discussion. Use a plain, discoverable Investigate and propose fix disclosure for model selection, time/cost limits, capability status, work controls, proposals, and validation details. Distinguish static inspection from checks actually run. Retain honest failed/cancelled work states. Proposal generation makes no remote change; applying must identify the exact source branch and patch manifest and respect real permissions. The reviewer role does not imply direct push access.
- **Q18 — Make setup contextual (B).** After authentication, arrive at intake. Explain GitHub access when starting a real review and offer the actual account connection flow. Preserve the entered URL and available review instructions across the connection handoff. Show service/model availability accurately, with clear blocked-state explanations; do not make infrastructure requirements the brand’s primary first-use message. Invalid URL, inaccessible PR, disconnected account, unavailable model, and unavailable service are distinct situations, not one generic form error. A valid URL alone does not imply the PR is accessible.
- **Q19 — Use a focused activity view while analysis runs (B).** Show PR identity, saved revision when known, real current progress, elapsed/activity information only when supported, and real cancellation or retry controls. Explain that saved background work can be revisited. Enter the brief workspace when the generated result exists. Available saved source remains reachable, but a nonexistent brief is not drawn as a completed workspace. Queued, active, stopped-reporting, failed, cancelled, and completed states need honest treatments. No invented percentages, fake completed checks, or timer-driven success transitions. Failure preserves saved work and gives the relevant recovery route rather than returning to an empty intake.
- **Q23 — Home is intake plus one Continue review entry (A).** Signed-in home stays clean and consistent. With recent saved work, include one prominent continuation entry carrying PR identity, actual analysis state, applicable revision status, and persisted human reading progress. Full history is in the header switcher. Without saved work, omit the continuation entry rather than showing placeholder activity. Do not automatically reopen a stale PR or create a metrics dashboard.
- **Q24 — Keep the complete source inventory on demand (A).** The brief and context spine retain an All changes control and an explicit Ungrouped count. Open a searchable file-and-hunk inventory that includes every saved hunk regardless of finding filters. Navigation from inventory reaches the same source plane, preserves exact location, and provides a return to the brief. With no usable generated groups, state that limitation and make all saved source available; do not fabricate purpose sections. An incomplete saved file/patch inventory must be described as incomplete, not counted as complete coverage.

### Cross-surface composition and behavior

These are implementation directions derived from the selected choices, not additional interview answers:

1. **Public landing:** one concise orientation promise and the interactive sample are the main content, followed by a clear real-review sign-in action and a concrete privacy/publication explanation. The sample, not an unrelated hero illustration, demonstrates the brand. Avoid fake metrics, testimonials, live activity, and invented repository outcomes.
2. **Authentication and accounts:** retain existing real authentication and account management. Apply compatible surrounding identity and supported provider styling; keep account controls reachable from the app header. GitHub connection state, access limitations, and recovery need plain explanations. Do not invent organization administration, billing, or permission controls not established by the product.
3. **Intake:** one primary PR input with validation and review context controls, contextual connection/readiness status, a Start review action, and an optional Continue entry. Preserve the actual model/instructions capabilities rather than removing them to clean up the screenshot.
4. **Activity:** a focused real-status plane framed by the same header and materials. It is a state of the saved review, not a separate stylistic product. The route back to history and existing saved source remains clear.
5. **Expanded brief:** PR identity and revision precede the generated account and purpose sections. Grounding, unread/read state, finding signals, and the complete-inventory escape hatch have consistent placement. Available readiness/assessment information is labeled as machine output and must not dominate the orientation promise.
6. **Reading workspace:** the brief becomes a context spine; selected source dominates. File identity, old/new line context, and saved revision remain discoverable. Source annotations are compact until inspection. Temporary history/account surfaces occupy a separate overlay layer rather than permanently competing with source.
7. **Revision change:** the interstitial makes the saved-versus-newer choice explicit, without erasing historical reading or automatically running expensive analysis. After choosing historical inspection, keep the saved revision label evident.
8. **Publication:** a dedicated, inspectable output plane preserves the same material identity but gives the external action its own boundary. The confirmation names the target and content; publication success is represented by a verified result and link.
9. **History:** use real PR titles/repository identity, saved review times and states, and explicit human progress where persisted. Support complete history access and finding the intended PR. Do not conflate analysis completed, sections read, review published, and branch updated into a single green Complete badge.

### Accessibility, reading, and material constraints

These requirements are not optional aesthetic preferences:

- Keyboard access to home, the review switcher, purpose sections, complete source inventory, evidence links, disclosures, read marking, publication preview, and account entry points. Make focus visible and preserve a sensible return target when temporary surfaces close.
- Move focus intentionally when brief/source modes or revision interstitials change. Do not steal focus during incoming analysis or discussion updates. Announce consequential asynchronous state changes without repeatedly reading source to assistive technology.
- Textual distinctions for severity, selection, read state, analysis state, freshness, and publication. Color, glow, and depth cannot be their sole representations.
- Accessible contrast on actual translucent backgrounds, not just isolated token swatches. Keep long explanatory text and code on stable opaque surfaces where needed.
- Reduced-motion behavior preserves the same structural state change without animated contractions or traveling elements. Any motion should explain the selected context; avoid ambient motion and animated blur during reading.
- No document-wide horizontal overflow at narrow widths or enlarged text. Source-local horizontal scrolling is acceptable when necessary to preserve code, provided its container and controls are accessible.
- Long filenames, long PR titles, many files, multiple findings on nearby lines, extensive discussions, sparse findings, and no findings must not break the composition. No findings does not mean no risk or no need for human reading.
- Restore source position and the active inspection predictably after inventory navigation, publication preview, and temporary header surfaces. Reading acknowledgment is explicit; position restoration is not a read mark.

## Implementation status

The 24 decisions above are implemented in the production app. Changed Convex functions were pushed to the configured dev deployment with `npx convex dev --once`. Production implementation is no longer deferred.

Implemented contracts:

- **Identity and typography:** graphite/cyan layered identity with self-hosted Spline Sans Mono; public interactive illustrative sample (explicitly labeled, no anonymous fetch/write); real Clerk authentication and account appearance preserved, including existing ChatGPT provider settings.
- **Intake and history:** focused intake whose URL/focus/model draft survives reload and is keyed per account so state cannot carry across accounts; header history switcher with full pagination; separate machine-activity states (queued, active, stopped-reporting, failed, cancelled, completed) with no invented progress.
- **Reader:** new `review-reader` with complete saved inventory (every saved hunk reachable regardless of finding filters) and ungrouped source; desktop context spine beside exact saved source, mobile successive full-width views; unified diff by default with wide side-by-side split; Pierre CodeView inline findings with discussion first and progressively disclosed investigation/proposal work. Source stays mounted across brief/publication transitions. Missing saved source shows “Exact source unavailable” with the requested side/line, the recorded gap, and a pinned-source link — no substituted nearby anchor.
- **Read marks (Q21/Q22):** authenticated, persisted in Convex, scoped to owner + saved review + pinned head + purpose group, undoable, isolated from reassessments, and never inherited into a newly assessed revision. Failed writes are not shown as saved.
- **Publication (Q17):** exact serialized preview for both the normal body/comments and the summary-only fallback, rendered from the same serializer publication uses; SHA-256 confirmation bound to content, target, and live revisions; atomic claim/write authorization and uncertain-outcome recovery preserved. A base-tip/unknown-snapshot application guard sits alongside the existing head/ref/permission checks. Malformed confirmation requests are rejected (400); without GitHub access no confirmation is produced and publication stays disabled.
- **Revision acknowledgment (Q20):** changed revisions require the explicit saved-vs-newer choice; historical reading keeps its saved revision label, and unknown freshness remains unknown (an observed outdated state is retained when a later freshness lookup fails).

### Evidence

- Full test suite: 43 test files / 367 tests passed (re-run at handoff close, after final formatting). Typecheck (`tsc --noEmit`) and scoped ESLint on the touched reader/workspace/publication files pass.
- Actual app smoke (real Clerk sign-in with the project-config test identity): public sample source contraction on desktop and 390px; account setup modal with no grants; signed-in intake; draft surviving reload; history switching; generated brief with an exact hunk; inline finding with real saved discussion/proposal display; wide split; exact normal/fallback preview bodies matching the rendered `<pre>` output.
- Persisted marks smoke: marking an owned synthetic fixture section read survived reload/history (1/1), and was restored to unread (0/1) afterwards; no smoke mark was left behind.
- Layout boundaries checked at 320px and 390px, including 320px at 200% root font size and reduced-motion preference, with expanded inventory/findings/assessment/reassessment: document width equals viewport, and a high-severity filter with no matches leaves the full inventory available. Brief return focus lands below the sticky header.

### Blockers and unexercised flows

- `npm run check:env` reports sign-in, PR service, and Decisions available; Inngest is available. The live fixture PR flow is blocked solely by the missing GitHub connection for the project-config test account. No GitHub OAuth was bypassed, and no live publication, patch application, or permission grant occurred — do not claim a live worker/publish/apply run against a real PR.
- Synthetic saved-review UI/persistence smoke is not real live GitHub acceptance. The acceptance PR at https://github.com/hjwebb01/meteroite-review-fixture/pull/1 remains the target for live review once the test account is connected to GitHub.
- No completed accessibility audit is claimed; the checks above are targeted layout/focus/reduced-motion observations, not a full audit.

## Risks

Residual risks in the implemented design:

- Monospace and graphite can collapse into a familiar editor skin. The purpose-brief contraction, distinct reading planes, selective cyan context, and restrained material layers must carry identity without terminal cosplay.
- A narrow context spine can become an overfilled sidebar. Global history and account controls stay in the header and exhaustive source inventory stays on demand; do not put every product capability into the spine.
- Translucency and lighting can lower contrast or imply clickable hierarchy where none exists. They are restricted to navigation/temporary surfaces; code and extended reading stay on opaque surfaces.
- Inline finding inspection can disrupt code continuity and focus as threads grow. Stable anchors, nearby source, predictable closing, and honest scroll behavior are required.
- A generated brief can sound more certain than its evidence. Persistent provenance and local gaps must survive contraction, missing data, and large PRs.
- Purpose-section read totals can be mistaken for whole-PR completeness. Explicit ungrouped inventory and separate machine coverage prevent that interpretation; no read state grants merge approval.
- A focused activity view can feel like a waiting room. Real progress, background persistence, saved-source access, and recovery are preserved without invented progress.
- Revision interstitials can become repetitive blockers. Acknowledged historical viewing remains usable while the saved revision stays visibly identified.
- The public sample can be mistaken for a live review. Its source, interpretation, local state, and lack of remote side effects are labeled; authentication and real access checks still apply to real PRs.

## Deferred

No interview question was deferred; all 24 were answered. The following remain boundaries of the agreed direction, not forgotten deliverables:

- **A theme-preference system:** graphite is the chosen default. Reopen only if an actual product requirement for selectable/system themes is supplied; do not infer it from the atmosphere question.
- **Human per-finding disposition:** section reading was chosen instead. Reopen if feedback preparation requires a separate human judgment contract; do not reuse model conclusions or read marks for it.
- **Cross-revision read-mark matching:** explicitly rejected. Reopen only if repeated acknowledgment is demonstrated to be a serious usability problem and exact equivalence semantics can be justified.
- **Editable/selective publication, approval, and merge controls:** not selected and not established by the publish request. Reopen with an explicit change to the outgoing review contract; do not insert these capabilities through visual design.
- **New account domains:** no new billing, team administration, organization policy, or repository-permission-management product was requested. Account presentation remains within existing real identity and connection functionality.
- **Live GitHub acceptance:** blocked on connecting the test account to GitHub (see blockers above), not on implementation.

## Open threads

There were no per-question discussion threads, visual-feedback threads, unanswered questions, or unresolved recommendation changes at Finish. All 24 decisions are settled. The exact font asset, color token values, component dimensions, and motion timings were not separately selected by the user; choose them during implementation within the legibility, predominantly monospace, graphite/cyan, material-depth, and reduced-motion constraints above rather than treating arbitrary values as locked decisions.
