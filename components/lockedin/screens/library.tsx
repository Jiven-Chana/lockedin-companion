"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moduleHue } from "@/src/core";
import { lockedIn } from "../api";
import { fmtDay, useData } from "../hooks";
import { Icon, StatusTag } from "../icons";
import { Tint, useLockedIn } from "../root";
import { PageHead } from "../shell";

export function LibraryScreen() {
	const router = useRouter();
	const { now } = useLockedIn();
	const [q, setQ] = useState("");
	const roadmap = useData(() => lockedIn.roadmap());
	const search = useData(() => (q.trim() ? lockedIn.lectures(q.trim()) : Promise.resolve(null)), [q]);

	async function quiz(lectureId: string) {
		const { sessionId } = await lockedIn.startSession({ kind: "post-lecture", lectureId });
		router.push(`/app/session/${sessionId}`);
	}

	const hits = search.data ? new Set(search.data.map((l) => l.id)) : null;
	const modules = Object.entries(roadmap.data ?? {});

	return (
		<>
			<PageHead eyebrow="Library" title="Your lectures">
				<label className="li-row" style={{ marginTop: 12, maxWidth: 520, gap: 0, position: "relative" }}>
					<span className="li-sr">Search lectures and slides</span>
					<span style={{ position: "absolute", left: 14, color: "var(--li-muted)" }}><Icon.search /></span>
					<input className="li-input" style={{ paddingLeft: 44 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lectures and slides, e.g. ethnography" />
				</label>
			</PageHead>
			{modules.length === 0 && !roadmap.loading ? <div className="li-card li-empty">No lectures yet. Connect a calendar in Me.</div> : null}
			{modules.map(([code, list]) => {
				const shown = hits ? list.filter((l) => hits.has(l.id)) : list;
				if (hits && shown.length === 0) return null;
				return (
					<Tint key={code} hue={moduleHue(code)}>
						<section className="li-stack" aria-labelledby={`m-${code}`}>
							<div className="li-row">
								<span style={{ width: 14, height: 14, borderRadius: 5, background: "var(--li-accent)" }} />
								<h2 id={`m-${code}`} className="li-h2" style={{ flexGrow: 1 }}>{code}</h2>
								<span className="li-small li-muted">{list.filter((l) => l.status !== "not-started").length} of {list.length} started</span>
							</div>
							<div className="li-card" style={{ padding: "8px 24px" }}>
								{shown.map((l) => (
									<div key={l.id} className="li-tl">
										<span className="li-tl-time">Week {l.week}</span>
										<span style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
											<Link href={`/app/library/${l.id}`}><b>{l.title}</b></Link>
											<span className="li-small li-muted">{l.start ? fmtDay(l.start, now) : "From your course material"}{l.attended === false ? " · you weren't there" : ""}{l.hasMaterials ? "" : " · no slides yet"}</span>
										</span>
										{l.status === "revisit" ? <StatusTag status="revisit" /> : l.status === "answered" ? <StatusTag status="answered" /> : <StatusTag status="notyet" />}
										<Link className="li-btn soft" href={`/app/library/${l.id}`}>Open</Link>
										<button type="button" className="li-btn primary" disabled={!l.hasMaterials} onClick={() => quiz(l.id)}>Quiz me</button>
									</div>
								))}
							</div>
						</section>
					</Tint>
				);
			})}
		</>
	);
}
