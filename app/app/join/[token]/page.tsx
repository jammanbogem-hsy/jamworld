import JoinClass from "@/components/moa/join-class";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinClass token={token} />;
}
