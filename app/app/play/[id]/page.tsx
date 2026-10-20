import Play from "@/components/moa/play";

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Play projectId={id} />;
}
