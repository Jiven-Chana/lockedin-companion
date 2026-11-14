import { notFound } from "next/navigation";
import { demoEnabled } from "@/src/server";
import { FacilitatorScreen } from "@/components/lockedin/screens/facilitator";

export default function Page() {
	if (!demoEnabled()) notFound();
	return <FacilitatorScreen />;
}
