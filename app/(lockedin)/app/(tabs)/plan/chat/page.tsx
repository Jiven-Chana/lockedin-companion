import { Suspense } from "react";
import { SetupChatScreen } from "@/components/lockedin/screens/setup-chat";

export default function Page() {
	return (
		<Suspense>
			<SetupChatScreen />
		</Suspense>
	);
}
