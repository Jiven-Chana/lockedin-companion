"use client";

/**
 * Dictation for LockedIn's free-text boxes (v0.1 F-116): the engine's
 * Deepgram streaming (components/dictation.tsx) behind one small mic
 * button. Hidden without a Deepgram key (Me → Voice). Never required:
 * tapping stays the rule. Speech lands in the box when you stop, and
 * `finish()` lets a submit wait for the last words.
 */

import { useCallback, useEffect, useState } from "react";
import { useDictation } from "@/components/dictation";
import { lockedIn } from "./api";

let voiceKnown: boolean | null = null;

/** Whether a Deepgram key is saved (asked once per page load). */
export function useVoiceAvailable(): boolean {
	const [voice, setVoice] = useState(voiceKnown ?? false);
	useEffect(() => {
		if (voiceKnown !== null) return;
		lockedIn.ai.status().then((s) => { voiceKnown = !!s.voice; setVoice(voiceKnown); }).catch(() => undefined);
	}, []);
	return voice;
}

/** Forget the cached answer (Me → Voice after saving or removing the key). */
export function resetVoiceAvailable(value: boolean) {
	voiceKnown = value;
}

export function useMic(append: (text: string) => void, field: string) {
	const available = useVoiceAvailable();
	const dictation = useDictation({ append, disabled: !available });
	const toggle = useCallback(() => {
		if (dictation.phase === "idle") void lockedIn.event("dictation_used", { field });
		dictation.toggle();
	}, [dictation, field]);
	return { available, dictation, toggle };
}

export function MicButton({ mic }: { mic: ReturnType<typeof useMic> }) {
	const { available, dictation, toggle } = mic;
	if (!available) return null;
	const live = dictation.phase === "recording" || dictation.phase === "connecting";
	const label = dictation.phase === "connecting" ? "Starting…" : dictation.phase === "recording" ? "Stop" : dictation.phase === "stopping" ? "Finishing…" : "Speak";
	return (
		<span className="li-row" style={{ gap: 8, alignItems: "center" }}>
			<button type="button" className={`li-btn${live ? " primary" : ""}`} aria-pressed={live} disabled={dictation.phase === "stopping"} onClick={toggle} title={live ? "Stop and put what you said in the box" : "Say your reason instead of typing"}>
				<span aria-hidden="true">{live ? "■" : "🎙"}</span> {label}
			</button>
			{dictation.error ? <span className="li-small li-muted" role="alert">{dictation.error.startsWith("Dictation needs") ? "Add a Deepgram key in Me → Voice to speak." : dictation.error}</span> : null}
		</span>
	);
}
