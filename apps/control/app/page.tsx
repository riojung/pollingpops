import { loadControlConfig } from "@openround/control-plane";
import ControlRoom from "./room";
export const dynamic = "force-dynamic";
export default function Page() {
  const config = loadControlConfig();
  return <ControlRoom enabled={config.CONTROL_ENABLED} authMode={config.CONTROL_AUTH_MODE} />;
}
