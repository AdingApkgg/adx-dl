import { SurveyView } from "@/components/site/survey-view";
import { buildSurveyPageMetadata } from "@/lib/page-metadata";

export const metadata = buildSurveyPageMetadata("zh");

export default function SurveyPage() {
  return <SurveyView locale="zh" />;
}
