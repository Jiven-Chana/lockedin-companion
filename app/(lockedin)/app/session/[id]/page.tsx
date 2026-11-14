import { SessionScreen } from "@/components/lockedin/screens/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return <SessionScreen id={id} />;
}
