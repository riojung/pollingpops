/** A failed or blocked publication must leave the creator in the editor. */
export async function publishBeforePresent(
  publish: () => Promise<boolean>,
  present: () => void,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const published = await publish();
  if (!published || !isCurrent()) return false;
  present();
  return true;
}
