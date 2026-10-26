import { Confirmation } from '../../../components/restaurant';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Confirmation id={id} />;
}
