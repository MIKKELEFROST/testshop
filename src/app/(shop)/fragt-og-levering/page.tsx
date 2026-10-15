import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("fragt-og-levering");

export default function Page() {
  return <InfoPageView slug="fragt-og-levering" />;
}
