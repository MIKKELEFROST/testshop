import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("handelsbetingelser");

export default function Page() {
  return <InfoPageView slug="handelsbetingelser" />;
}
