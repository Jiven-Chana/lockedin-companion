"use client";

/**
 * A picture that builds up (v3.2, V-101). The blocks and links are the
 * diagram's; its comment lines say which blocks arrive at each step and,
 * optionally, one block to guess first (src/core/companion/picture.ts).
 *
 * The guess comes first and is never marked: mint when right, lilac when
 * not, with the reason, and "Show me instead" beside it. Then the picture
 * arrives a step at a time, at the student's pace, with "Show it all" for a
 * student who knows it. Enlarged, it is the same picture at the same step.
 */

import { useEffect, useMemo, useState } from "react";
import { PICTURE_COPY, PICTURE_RULES, layoutMap, parsePictureScript, parseSimpleFlow, pictureFrame } from "@/src/core";
import { lockedIn } from "./api";
import { BlocksMap } from "./blocks-map";
import { InlineProse, Prose } from "./prose";

const stop = (title: string) => (/[.!?…:]$/.test(title) ? title : `${title}.`);

export function SteppedPicture({ source }: { source: string }) {
	const flow = useMemo(() => parseSimpleFlow(source) ?? { nodes: [], edges: [] }, [source]);
	const ids = useMemo(() => flow.nodes.map((n) => n.id), [flow]);
	const script = useMemo(() => parsePictureScript(source, ids) ?? { steps: [] }, [source, ids]);
	const { steps, gap } = script;
	// The picture's own size, so its box can be exactly that wide and the sentence can sit beside it.
	const natural = useMemo(() => { const l = layoutMap(flow.nodes, flow.edges, PICTURE_RULES.size); return { w: l.width + 22, h: l.height + 22 }; }, [flow]);
	const [guess, setGuess] = useState<number | "shown" | null>(null);
	const [guessing, setGuessing] = useState(!!gap);
	const [at, setAt] = useState(0);
	const [all, setAll] = useState(false);
	const [large, setLarge] = useState(false);
	const [room, setRoom] = useState(0);
	useEffect(() => {
		if (!large) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLarge(false); };
		// Enlarged, the picture grows to the window's height and no further: the sentence and the buttons stay on screen beside it.
		const measure = () => setRoom(window.innerHeight - PICTURE_RULES.largeChrome);
		measure();
		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", measure);
		return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", measure); };
	}, [large]);

	const frame = pictureFrame(script, ids, guessing || all ? "all" : at);
	// The same set while the same blocks are shown, so the map is not laid out again on every press.
	const shownKey = frame.shown.join("\n");
	const hidden = useMemo(() => { const shown = new Set(shownKey.split("\n")); return new Set(ids.filter((id) => !shown.has(id))); }, [ids, shownKey]);
	const right = gap?.options.find((o) => o.right);
	const picked = typeof guess === "number" ? gap?.options[guess] : undefined;

	function choose(choice: number | "shown") {
		setGuess(choice);
		void lockedIn.event("picture_gap", { choice: choice === "shown" ? "shown" : gap?.options[choice]?.right ? "right" : "other" });
	}
	function step(to: number) {
		setAt(to);
		if (to === steps.length - 1 && at !== to) void lockedIn.event("picture_done", { steps: steps.length });
	}

	const body = (big: boolean) => {
		// Enlarged, as large as the window's height allows, up to the limit. Never smaller than its own size.
		const grow = big && room > 0 ? Math.max(1, Math.min(PICTURE_RULES.grow, room / natural.h)) : 1;
		return (
			<div className="li-pic" data-large={big || undefined}>
				<div className="li-row li-pic-head">
					{guessing ? (
						<span className="li-stage-head" data-stage="guess"><b>{PICTURE_COPY.gapHead}</b><span>{PICTURE_COPY.gapNote}</span></span>
					) : steps.length ? (
						<>
							<span className="li-pic-dots" aria-hidden="true">{steps.map((_, i) => <i key={i} data-s={all || i < at ? "done" : i === at ? "now" : undefined} />)}</span>
							<span className="li-small">{all ? PICTURE_COPY.whole : PICTURE_COPY.stepOf(at + 1, steps.length)}</span>
						</>
					) : null}
					<span style={{ flexGrow: 1 }} />
					{big ? <button type="button" className="li-btn ghost" onClick={() => setLarge(false)}>{PICTURE_COPY.close}</button> : <button type="button" className="li-btn ghost" onClick={() => setLarge(true)}>{PICTURE_COPY.enlarge}</button>}
				</div>
				{/* The picture, and beside it (below it, when there is no room beside) what is said about it and the buttons. */}
				<div className="li-pic-main">
					<div className="li-pic-map" style={{ flexBasis: Math.ceil(natural.w * grow) }}>
						<BlocksMap
							nodes={flow.nodes} edges={flow.edges} label={PICTURE_COPY.label} hidden={hidden} size={PICTURE_RULES.size} grow={grow} narrowAt={0}
							block={(n, { style, column }) => {
								const gone = hidden.has(n.id);
								// In one column a block that has not arrived takes no room; on the map it keeps its place, unseen.
								if (gone && column) return null;
								const here = guessing && gap?.node === n.id;
								const lit = frame.lit.includes(n.id);
								const note = frame.notes[n.id];
								return (
									<div key={n.id} className="li-idea plain li-pic-block" style={style} data-gone={gone || undefined} data-lit={lit || undefined} data-dim={(!lit && frame.lit.length > 0) || undefined} data-hole={(here && guess === null) || undefined} data-tone={here && guess !== null ? "mint" : undefined}>
										{note ? <i className="li-pic-note">{note}</i> : null}
										<b>{here && guess === null ? "?" : <InlineProse text={n.label} />}</b>
									</div>
								);
							}}
						/>
					</div>
					<div className="li-pic-side">
						{guessing && gap ? (
							<>
								<p className="li-pic-ask"><InlineProse text={gap.ask} /></p>
								<div className="li-pic-tray" role="group" aria-label={gap.ask}>
									{gap.options.map((o, i) => <button key={i} type="button" className="li-btn" aria-pressed={guess === i} disabled={guess !== null} onClick={() => choose(i)}><InlineProse text={o.label} /></button>)}
								</div>
								{guess === null ? (
									<button type="button" className="li-link li-small li-pic-skip" onClick={() => choose("shown")}>{PICTURE_COPY.showMe}</button>
								) : (
									<div className="li-pic-verdict" data-tone={picked && !picked.right ? "lilac" : "mint"} role="status">
										<b>{guess === "shown" ? PICTURE_COPY.itIs(right?.label ?? "") : picked?.right ? PICTURE_COPY.yes : PICTURE_COPY.no}</b>{" "}
										<InlineProse text={picked && !picked.right ? `${picked.why} ${PICTURE_COPY.itIs(right?.label ?? "")} ${right?.why ?? ""}`.trim() : right?.why ?? ""} />
									</div>
								)}
								{guess !== null ? <div className="li-row"><button type="button" className="li-btn primary" onClick={() => { setGuessing(false); setAt(0); }}>{steps.length ? PICTURE_COPY.build : PICTURE_COPY.seeIt} ›</button></div> : null}
							</>
						) : steps.length ? (
							<>
								<div className="li-pic-say" aria-live="polite">
									{all ? <Prose text={steps.map((s, i) => `${i + 1}. ${s.title ? `**${stop(s.title)}** ` : ""}${s.say}`).join("\n")} /> : <Prose text={`${steps[at]!.title ? `**${stop(steps[at]!.title!)}** ` : ""}${steps[at]!.say}`} />}
								</div>
								<div className="li-row li-pic-nav">
									<button type="button" className="li-btn" disabled={all || at === 0} onClick={() => step(at - 1)}>‹ {PICTURE_COPY.back}</button>
									{all || at < steps.length - 1 ? <button type="button" className="li-btn primary" disabled={all} onClick={() => step(at + 1)}>{PICTURE_COPY.next} ›</button> : <button type="button" className="li-btn" onClick={() => step(0)}>{PICTURE_COPY.again}</button>}
								</div>
								<button type="button" className="li-btn ghost li-pic-all" aria-pressed={all} onClick={() => setAll(!all)}>{all ? PICTURE_COPY.bySteps : PICTURE_COPY.all}</button>
							</>
						) : null}
					</div>
				</div>
			</div>
		);
	};

	return (
		<>
			{body(false)}
			{large ? (
				<div className="li-diagram-overlay" role="dialog" aria-modal="true" aria-label={PICTURE_COPY.label} onClick={() => setLarge(false)}>
					<div className="li-pic-large" onClick={(e) => e.stopPropagation()}>{body(true)}</div>
				</div>
			) : null}
		</>
	);
}
