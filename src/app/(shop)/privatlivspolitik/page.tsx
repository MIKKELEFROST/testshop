import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("privatlivspolitik");

export default function Page() {
  return <InfoPageView slug="privatlivspolitik" />;
}
