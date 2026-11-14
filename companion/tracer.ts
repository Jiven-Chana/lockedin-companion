/**
 * The tracer bullet (plan §1 checkpoint, §6.9 criteria 1 and 4): prepare a
 * real companion session on the LearnHarness engine, in-process, and print
 * question 1 with its latency and cost.
 *
 *   npm run companion:tracer                          # hci-w3-personas, 1 run
 *   npm run companion:tracer -- gt-w2-nash --runs 5   # 5 cold runs, median latency
 *   npm run companion:tracer -- --answer              # also answer Q1 and time Q2
 *
 * Needs: npm run companion:seed, model slots configured, a provider key in
 * .env.local. Uses LH_DATA_DIR (default ./data). Every run is logged to the
 * companion event log (session_prepared carries latencyMs).
 */

import { createCompanionService } from "../src/server/companion/default.ts";

const args = process.argv.slice(2);
const lectureId = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "hci-w3-personas";
const runsIdx = args.indexOf("--runs");
const runs = runsIdx >= 0 ? Math.max(1, Number(args[runsIdx + 1]) || 1) : 1;
const answer = args.includes("--answer");

const svc = createCompanionService({ ...process.env, COMPANION_ENGINE: "learnharness", COMPANION_AUTO_FALLBACK: "0" });
const health = svc.health();
console.log("engine status:", JSON.stringify(health.engines));
if (!svc.profile()) svc.onboard({ timetableSource: "sample" });

const latencies: number[] = [];
for (let i = 1; i <= runs; i++) {
	const t0 = Date.now();
	const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId }), { engine: "learnharness" });
	await svc.whenReady(sessionId);
	const view = await svc.view(sessionId);
	const ms = Date.now() - t0;
	console.log(`\n── run ${i}/${runs}: ${view.status} in ${(ms / 1000).toFixed(1)} s (session ${sessionId})`);
	if (view.status !== "question" || !view.question) {
		console.log(`   error: ${view.error ?? view.status}`);
		continue;
	}
	latencies.push(ms);
	console.log(`   goal: ${view.goal}`);
	if (view.prose) console.log(`   lead-in: ${view.prose.split("\n").join(" ").slice(0, 200)}`);
	console.log(`   Q1 (${view.question.role}): ${view.question.stem}`);
	for (const o of view.question.options) console.log(`     ${o.index}. ${o.label}`);
	console.log(`   can hint: ${view.canHint}`);
	if (answer) {
		const t1 = Date.now();
		await svc.answer(sessionId, { questionId: view.question.id, indices: [1], confidence: 50, why: "tracer" });
		for (;;) {
			const v = await svc.view(sessionId);
			if (v.status !== "thinking") {
				console.log(`   after answer: ${v.status} in ${((Date.now() - t1) / 1000).toFixed(1)} s; feedback correct=${v.feedback?.correct}; Q2: ${v.question?.stem ?? "-"}`);
				break;
			}
			await new Promise((r) => setTimeout(r, 750));
		}
	}
	console.log(`   cost so far: ${JSON.stringify(svc.sessionCost(sessionId).cost)}`);
}

if (latencies.length > 0) {
	const sorted = [...latencies].sort((a, b) => a - b);
	console.log(`\nquestion 1 latency (cold): median ${(sorted[Math.floor(sorted.length / 2)]! / 1000).toFixed(1)} s over ${sorted.length} run(s); checkpoint target ≤ 20 s cold`);
}
process.exit(latencies.length === runs ? 0 : 1);
