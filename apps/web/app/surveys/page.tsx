import { redirect } from "next/navigation";

export default function SurveysPage() {
  redirect("/library?type=surveys");
}
