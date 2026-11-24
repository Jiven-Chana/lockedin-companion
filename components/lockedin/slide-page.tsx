"use client";

/**
 * One slide of a lecture or course unit. A unit that kept its PDF shows the
 * real page as a picture (v1.0 S-2, V-21), drawn on this laptop and reached
 * through /materials/:id/pages/:n. The page's text stays one tap away, for
 * screen readers and for copying. A unit with no PDF (the sample lectures,
 * pasted notes) shows the slide text, as does a page whose picture fails.
 */

import { useEffect, useState } from "react";
import type { SlideSection } from "./api";
import { Prose } from "./prose";

export const slidePageSrc = (lectureId: string, page: number) => `/api/companion/materials/${encodeURIComponent(lectureId)}/pages/${page}`;

export function SlidePage({ lectureId, slide, hasPdf, onSlide }: { lectureId: string; slide: SlideSection; hasPdf: boolean; onSlide?: (n: number) => void }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [lectureId, slide.number]);
	if (!hasPdf || failed) {
		return (
			<>
				<h3>{slide.title}</h3>
				<Prose text={slide.body} onSlide={onSlide} />
			</>
		);
	}
	return (
		<>
			{/* A picture this app draws itself, per page: next/image has nothing to optimise here. */}
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img className="li-page-img" src={slidePageSrc(lectureId, slide.number)} alt={`Page ${slide.number}${slide.title ? `: ${slide.title}` : ""}`} onError={() => setFailed(true)} />
			<details className="li-page-text">
				<summary>Read this page as text</summary>
				<Prose text={slide.body} onSlide={onSlide} />
			</details>
		</>
	);
}
