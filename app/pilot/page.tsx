import PilotClient from "./pilot-client";
import "./pilot.css";

export const metadata = {
  title: "序｜正式測試",
  description: "PantryFlow 正式資料測試入口",
};

export default function PilotPage() {
  return <PilotClient />;
}
