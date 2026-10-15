import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("kontakt");

export default function Page() {
  return <InfoPageView slug="kontakt" />;
}
