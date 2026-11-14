import { LectureScreen } from "@/components/lockedin/screens/lecture";

export default async function Page({ params }: { params: Promise<{ lectureId: string }> }) {
	const { lectureId } = await params;
	return <LectureScreen lectureId={lectureId} />;
}
