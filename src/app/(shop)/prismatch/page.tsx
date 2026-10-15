import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("prismatch");

export default function Page() {
  return <InfoPageView slug="prismatch" />;
}
