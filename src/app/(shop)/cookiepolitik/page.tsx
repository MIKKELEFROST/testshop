import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("cookiepolitik");

export default function Page() {
  return <InfoPageView slug="cookiepolitik" />;
}
