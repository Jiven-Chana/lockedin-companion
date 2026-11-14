/**
 * The companion clock (plan §7.3): every "now" goes through clock.now() —
 * real time plus an offset the facilitator can set. Without it nudges can't
 * be tested; a usability task can't wait for a real lecture to end.
 *
 * The offset lives in the store (demo.json), so every route and a server
 * restart see the same demo time.
 */

export interface Clock {
	now(): Date;
}

export class OffsetClock implements Clock {
	constructor(
		private readonly offsetMs: () => number,
		private readonly realNow: () => number = Date.now,
	) {}

	now(): Date {
		return new Date(this.realNow() + this.offsetMs());
	}

	/** The offset that makes now() return `target`. */
	offsetFor(target: Date): number {
		return target.getTime() - this.realNow();
	}
}

/** A clock tests can set and advance. */
export class ManualClock implements Clock {
	constructor(private t: Date) {}
	now(): Date {
		return new Date(this.t);
	}
	set(t: Date): void {
		this.t = new Date(t);
	}
	advanceMinutes(n: number): void {
		this.t = new Date(this.t.getTime() + n * 60_000);
	}
}
