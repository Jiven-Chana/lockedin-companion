import { Suspense } from "react";
import { PlanScreen } from "@/components/lockedin/screens/plan";

export default function Page() {
	return (
		<Suspense>
			<PlanScreen />
		</Suspense>
	);
}
