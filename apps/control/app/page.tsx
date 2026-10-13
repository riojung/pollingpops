import { loadControlConfig } from "@openround/control-plane";
import ControlRoom from "./room";
export const dynamic = "force-dynamic";
export default function Page() {
  const enabled = loadControlConfig().CONTROL_ENABLED;
  return <ControlRoom enabled={enabled} />;
}
