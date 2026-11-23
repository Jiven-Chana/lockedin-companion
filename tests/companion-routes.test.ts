/**
 * The HTTP surface (plan §9) end to end: real route modules, the real
 * service singleton, an isolated LH_DATA_DIR, the scripted engine. This is
 * the smoke test for J1 and J2 that the plan puts in Playwright, minus the
 * browser: the phone UI only has to call these routes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "companion-routes-"));
process.env.LH_DATA_DIR = TMP;
process.env.COMPANION_ENGINE = "scripted";
process.env.COMPANION_DEMO = "1";
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const r = {
	health: await import("../app/api/companion/health/route.ts"),
	onboarding: await import("../app/api/companion/onboarding/route.ts"),
	profile: await import("../app/api/companion/profile/route.ts"),
	today: await import("../app/api/companion/today/route.ts"),
	lectures: await import("../app/api/companion/lectures/route.ts"),
	missed: await import("../app/api/companion/lectures/[id]/missed/route.ts"),
	reads: await import("../app/api/companion/reads/route.ts"),
	due: await import("../app/api/companion/nudges/due/route.ts"),
	nudgeAction: await import("../app/api/companion/nudges/[id]/[action]/route.ts"),
	sessions: await import("../app/api/companion/sessions/route.ts"),
	session: await import("../app/api/companion/sessions/[id]/route.ts"),
	answer: await import("../app/api/companion/sessions/[id]/answer/route.ts"),
	hint: await import("../app/api/companion/sessions/[id]/hint/route.ts"),
	showMe: await import("../app/api/companion/sessions/[id]/show-me/route.ts"),
	more: await import("../app/api/companion/sessions/[id]/more/route.ts"),
	stop: await import("../app/api/companion/sessions/[id]/stop/route.ts"),
	progress: await import("../app/api/companion/progress/route.ts"),
	blocks: await import("../app/api/companion/blocks/route.ts"),
	materials: await import("../app/api/companion/materials/[lectureId]/route.ts"),
	events: await import("../app/api/companion/events/route.ts"),
	csv: await import("../app/api/companion/events.csv/route.ts"),
	data: await import("../app/api/companion/data/route.ts"),
	demoState: await import("../app/api/companion/demo/state/route.ts"),
	demoClock: await import("../app/api/companion/demo/clock/route.ts"),
	demoScenario: await import("../app/api/companion/demo/scenario/route.ts"),
	demoFire: await import("../app/api/companion/demo/fire/route.ts"),
	demoParticipant: await import("../app/api/companion/demo/participant/route.ts"),
};

const URL_BASE = "http://localhost:3000/api/companion";
const req = (method: string, body?: unknown) =>
	new Request(URL_BASE, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
async function json(res: Response | Promise<Response>, status = 200) {
	const r2 = await res;
	const text = await r2.text();
	assert.equal(r2.status, status, text);
	return text ? JSON.parse(text) : null;
}

describe("companion HTTP routes", () => {
	it("health works before onboarding, on the scripted engine", async () => {
		const h = await json(r.health.GET(req("GET")));
		assert.equal(h.defaultEngine, "scripted");
		assert.equal(h.onboarded, false);
		assert.deepEqual(await json(r.due.GET(req("GET"))), { nudge: null, prepared: [] });
		// Only the first taste (the bundled sample lecture, J1′) may start before onboarding.
		await json(r.sessions.POST(req("POST", { kind: "post-lecture", lectureId: "hci-w3-personas" })), 409);
		await json(r.sessions.POST(req("POST", { kind: "try-now", lectureId: "hci-w4-fieldwork" })), 409);
	});

	it("J1: onboarding → try-now → question 1 in three calls", async () => {
		const ob = await json(r.onboarding.POST(req("POST", { modules: ["HCI", "GT"], timetableSource: "sample", nudgesPerDay: 1 })));
		assert.equal(ob.reads.location, "never read");
		const { sessionId } = await json(r.sessions.POST(req("POST", ob.tryNow.spec)));
		let view = await json(r.session.GET(req("GET"), ctx({ id: sessionId })));
		for (let i = 0; view.status === "preparing" && i < 50; i++) {
			await new Promise((res) => setTimeout(res, 10));
			view = await json(r.session.GET(req("GET"), ctx({ id: sessionId })));
		}
		assert.equal(view.status, "question");
		assert.equal(view.engine, "scripted");
		assert.doesNotMatch(JSON.stringify(view), /"correct"\s*:\s*\[/);

		const hint = await json(r.hint.POST(req("POST", { questionId: view.question.id }), ctx({ id: sessionId })));
		assert.ok(hint.text.length > 0);
		await json(r.showMe.POST(req("POST", { questionId: view.question.id }), ctx({ id: sessionId })), 204);
		const shown = await json(r.session.GET(req("GET"), ctx({ id: sessionId })));
		assert.match(shown.prose, /Worked example|Have a look at Slide \d/);

		const res = await json(r.answer.POST(req("POST", { questionId: view.question.id, indices: [1], confidence: 70, why: "I think so" }), ctx({ id: sessionId })));
		assert.equal(typeof res.correct, "boolean");
		await json(r.answer.POST(req("POST", { questionId: view.question.id, indices: [1] }), ctx({ id: sessionId })), 409);
		await json(r.answer.POST(req("POST", { questionId: "x", confidence: 42, indices: [1] }), ctx({ id: sessionId })), 400);
		assert.equal((await json(r.more.POST(req("POST", {}), ctx({ id: sessionId })))).budget, 6);
		await json(r.stop.POST(req("POST"), ctx({ id: sessionId })), 204);
		await json(r.session.GET(req("GET"), ctx({ id: "s_nope" })), 404);
	});

	it("J2 through the facilitator routes: scenario → clock → nudge → open", async () => {
		await json(r.demoParticipant.POST(req("POST", { participant: "P07" })));
		const sc = await json(r.demoScenario.POST(req("POST", { name: "tayo" })));
		assert.equal(sc.scenario, "tayo");
		const end = new Date(new Date(sc.now).getTime() + 2 * 60_000);
		await json(r.demoClock.POST(req("POST", { set: end.toISOString() })));
		const prewarm = await json(r.due.GET(req("GET")));
		assert.equal(prewarm.prepared.length, 1);
		await json(r.demoClock.POST(req("POST", { advanceMinutes: 5 })));
		const { nudge } = await json(r.due.GET(req("GET")));
		assert.equal(nudge.type, "N-1");
		assert.equal(nudge.ready, true);
		const opened = await json(r.nudgeAction.POST(req("POST"), ctx({ id: nudge.id, action: "open" })));
		assert.equal(opened.sessionId, nudge.sessionId);
		const view = await json(r.session.GET(req("GET"), ctx({ id: opened.sessionId })));
		assert.equal(view.status, "question");
		await json(r.answer.POST(req("POST", { questionId: view.question.id, dontKnow: true }), ctx({ id: opened.sessionId })));
		assert.equal(fs.readdirSync(path.join(TMP, "companion", "archive")).length, 1, "the scenario reset archived J1's events");
		await json(r.nudgeAction.POST(req("POST"), ctx({ id: nudge.id, action: "dismiss" })), 409);
		await json(r.nudgeAction.POST(req("POST"), ctx({ id: nudge.id, action: "explode" })), 400);
	});

	it("the rest of the surface responds", async () => {
		const today = await json(r.today.GET(req("GET")));
		assert.equal(today.onboarded, true);
		const lectures = await json(r.lectures.GET(new Request(`${URL_BASE}/lectures?module=HCI&q=personas`)));
		assert.deepEqual(lectures.lectures.map((l: { id: string }) => l.id), ["hci-w3-personas"]);
		assert.equal((await json(r.missed.POST(req("POST"), ctx({ id: "hci-w4-fieldwork" })))).attended, false);
		assert.equal((await json(r.reads.GET(req("GET")))).label, "Sample timetable");
		assert.ok((await json(r.progress.GET(req("GET")))).week);
		assert.equal((await json(r.materials.GET(req("GET"), ctx({ lectureId: "hci-w3-personas" })))).slides.length, 10);
		await json(r.blocks.PUT(req("PUT", [{ id: "b1", weekday: 3, start: "15:00", minutes: 25, skippedDates: [] }])));
		await json(r.blocks.PUT(req("PUT", [{ id: "b1", weekday: 9 }])), 400);
		const profile = await json(r.profile.PUT(req("PUT", { prefs: { nudgesPerDay: 2 }, appearance: { theme: "dark" } })));
		assert.equal(profile.prefs.nudgesPerDay, 2);
		await json(r.events.POST(req("POST", { type: "onboarding_step", data: { step: 2 } })));
		const fired = await json(r.demoFire.POST(req("POST", { type: "N-3" })));
		assert.equal(fired.forced, true);
	});

	it("the CSV carries participant ids and the journey's events", async () => {
		const res = await r.csv.GET(req("GET"));
		assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
		const csv = await res.text();
		for (const type of ["onboarding_done", "nudge_fired", "nudge_opened", "question_shown", "answer", "wasnt_there", "settings_changed", "onboarding_step"]) {
			assert.match(csv, new RegExp(`,${type},`), type);
		}
		assert.match(csv, /,P07,/);
		// J1 ran before the scenario reset: its events are in the archive, not lost.
		const archiveDir = path.join(TMP, "companion", "archive");
		const archived = fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]!), "utf-8");
		for (const type of ["hint", "show_me", "keep_going", "session_stopped", "answer"]) assert.match(archived, new RegExp(`"type":"${type}"`), type);
	});

	it("facilitator routes are off unless COMPANION_DEMO=1; uploads are for everyone (F-104)", async () => {
		process.env.COMPANION_DEMO = "0";
		try {
			await json(r.demoState.GET(req("GET")), 404);
			await json(r.csv.GET(req("GET")), 404);
			// Not the demo 404: the upload route now runs, and refuses one junk byte as an unreadable PDF.
			const res = await r.materials.POST(new Request(URL_BASE, { method: "POST", body: new Uint8Array([1]) }), ctx({ lectureId: "hci-w3-personas" }));
			assert.notEqual(res.status, 404);
		} finally {
			process.env.COMPANION_DEMO = "1";
		}
	});

	it("delete all my data", async () => {
		assert.deepEqual(await json(r.data.DELETE(req("DELETE"))), { deleted: true });
		assert.equal((await json(r.profile.GET(req("GET")))).profile, null);
		assert.ok((await json(r.materials.GET(req("GET"), ctx({ lectureId: "hci-w3-personas" })))).hasMaterials, "lecture content stays");
	});

	it("malformed JSON is a 400, not a crash", async () => {
		const bad = new Request(URL_BASE, { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
		const res = await json(r.onboarding.POST(bad), 400);
		assert.equal(res.code, "bad_json");
	});
});
