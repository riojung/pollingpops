import { redirect } from "next/navigation";

export default function SurveysPage() {
  redirect("/sessions?type=surveys");
}
